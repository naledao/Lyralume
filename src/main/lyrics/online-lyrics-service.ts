import type {
  OnlineLyricsErrorCode,
  OnlineLyricsTask,
  OnlineLyricsTaskError,
} from '../../shared/contracts.js';
import path from 'node:path';
import { LibraryDatabase } from '../library/database.js';
import { LibraryService } from '../library/service.js';
import { logger } from '../logging.js';
import { TrackWriteBusyError, TrackWriteCoordinator } from '../track-write-coordinator.js';
import { Kid3Adapter, Kid3Error } from './kid3.js';
import { LrclibClient, LrclibError } from './lrclib.js';
import { rankLyricsCandidates } from './matching.js';
import { LrcSaveError, saveLrcAtomically } from './safe-lrc.js';

function idleTask(trackId: string): OnlineLyricsTask {
  return {
    id: `online-${trackId}`,
    trackId,
    status: 'idle',
    source: 'lrclib',
    candidates: [],
    lrcSaveStatus: 'not_started',
    tagWriteStatus: 'not_started',
    updatedAt: Date.now(),
  };
}

function taskError(code: OnlineLyricsErrorCode, message: string): OnlineLyricsTaskError {
  return { code, message };
}

export class OnlineLyricsService {
  private readonly initializedTasks = new Set<string>();

  constructor(
    private readonly database: LibraryDatabase,
    private readonly library: LibraryService,
    private readonly lrclib: LrclibClient,
    private readonly kid3: Kid3Adapter,
    private readonly trackWrites = new TrackWriteCoordinator(),
  ) {}

  getTask(trackId: string): OnlineLyricsTask {
    const track = this.database.getTrackLocation(trackId);
    if (!track) {
      return {
        ...idleTask(trackId),
        status: 'failed',
        error: taskError('track_not_found', '音乐库中找不到这首歌曲'),
      };
    }
    const firstRead = !this.initializedTasks.has(trackId);
    this.initializedTasks.add(trackId);
    const stored = this.database.getOnlineLyricsTask(trackId);
    if (!stored) return idleTask(trackId);
    if (firstRead && ['querying', 'saving', 'writing_tag'].includes(stored.status)) {
      return this.update(stored, {
        status: 'failed',
        lrcSaveStatus: stored.status === 'saving' ? 'failed' : stored.lrcSaveStatus,
        tagWriteStatus: stored.status === 'writing_tag' ? 'failed' : stored.tagWriteStatus,
        error: taskError('task_interrupted', '上次任务在应用退出前未完成，可以安全重试'),
      });
    }
    return stored;
  }

  async search(trackId: string): Promise<OnlineLyricsTask> {
    const track = this.database.getTrackLocation(trackId);
    if (!track) return this.getTask(trackId);
    let task = this.update(this.getTask(trackId), {
      status: 'querying',
      source: 'lrclib',
      candidates: [],
      selectedCandidateId: undefined,
      lrcFileName: undefined,
      lrcSaveStatus: 'not_started',
      tagWriteStatus: 'not_started',
      error: undefined,
    });
    logger.info(`[task:${task.id}] Querying LRCLIB for ${track.title}`);
    try {
      const records = await this.lrclib.search(track);
      if (records.length === 0) {
        return this.fail(task, 'no_match', 'LRCLIB 没有找到匹配结果');
      }
      const candidates = rankLyricsCandidates(track, records);
      if (candidates.length === 0) {
        return this.fail(
          task,
          'missing_synced_lyrics',
          'LRCLIB 找到了歌曲，但结果不包含可用的同步歌词',
        );
      }
      const recommended = candidates.find((candidate) => candidate.recommended);
      task = this.update(task, {
        status: 'awaiting_confirmation',
        candidates,
        selectedCandidateId: recommended?.id,
        error: undefined,
      });
      logger.info(`[task:${task.id}] LRCLIB returned ${candidates.length} synchronized candidates`);
      return task;
    } catch (error) {
      if (error instanceof LrclibError) {
        return this.fail(
          task,
          error.kind === 'network' ? 'network_error' : 'service_error',
          error.message,
        );
      }
      return this.fail(task, 'service_error', 'LRCLIB 查询失败，请稍后重试');
    }
  }

  async save(
    trackId: string,
    candidateId: number,
    overwriteExisting = false,
  ): Promise<OnlineLyricsTask> {
    const track = this.database.getTrackLocation(trackId);
    if (!track) return this.getTask(trackId);
    let task = this.getTask(trackId);
    const candidate = task.candidates.find((item) => item.id === candidateId);
    if (!candidate) return this.fail(task, 'candidate_not_found', '候选已失效，请重新查询');

    task = this.update(task, {
      status: 'saving',
      selectedCandidateId: candidateId,
      lrcSaveStatus: 'saving',
      error: undefined,
    });
    logger.info(`[task:${task.id}] Saving LRCLIB candidate ${candidateId}`);
    try {
      const lrcPath = await saveLrcAtomically(track.filePath, candidate.syncedLyrics, overwriteExisting);
      this.database.setTrackLrcPath(trackId, lrcPath);
      this.library.refreshSnapshot();
      task = this.update(task, {
        status: 'saved',
        lrcFileName: path.basename(lrcPath),
        lrcSaveStatus: 'saved',
        tagWriteStatus: 'not_started',
        error: undefined,
      });
      logger.info(`[task:${task.id}] LRC saved successfully`);
      return task;
    } catch (error) {
      if (error instanceof LrcSaveError) {
        const code = error.kind === 'existing'
          ? 'existing_lrc'
          : error.kind === 'invalid' ? 'invalid_lrc' : 'save_failed';
        return this.fail(task, code, error.message, { lrcSaveStatus: 'failed' });
      }
      return this.fail(task, 'save_failed', 'LRC 保存失败', { lrcSaveStatus: 'failed' });
    }
  }

  async writeTag(trackId: string, candidateId?: number): Promise<OnlineLyricsTask> {
    const track = this.database.getTrackLocation(trackId);
    if (!track) return this.getTask(trackId);
    let task = this.getTask(trackId);
    const candidate = candidateId === undefined
      ? undefined
      : task.candidates.find((item) => item.id === candidateId);
    if (candidateId !== undefined && !candidate) {
      return this.fail(task, 'candidate_not_found', '候选已失效，请重新查询');
    }
    if (!candidate && (!track.lrcPath || task.lrcSaveStatus !== 'saved')) {
      return this.fail(task, 'invalid_request', '请先保存在线歌词，再写入音频标签');
    }
    if (this.trackWrites.isBusy(trackId)) {
      return {
        ...task,
        error: taskError('write_in_progress', '这首歌曲已有标签写入任务正在运行'),
        updatedAt: Date.now(),
      };
    }

    task = this.update(task, {
      status: 'writing_tag',
      selectedCandidateId: candidateId ?? task.selectedCandidateId,
      tagWriteStatus: 'writing',
      error: undefined,
    });
    logger.info(`[task:${task.id}] Writing synchronized lyrics with kid3-cli`);
    try {
      await this.trackWrites.run(trackId, async () => {
        if (candidate) {
          await this.kid3.writeLyricsAndVerify(track.filePath, candidate.syncedLyrics, 'Lyralume / LRCLIB');
        }
        else await this.kid3.writeAndVerify(track.filePath, track.lrcPath as string);
      });
      this.database.setTrackEmbeddedLyrics(trackId, true);
      this.library.refreshSnapshot();
      task = this.update(task, {
        status: 'completed',
        tagWriteStatus: 'verified',
        error: undefined,
      });
      logger.info(`[task:${task.id}] Kid3 write and readback verification completed`);
      return task;
    } catch (error) {
      if (error instanceof TrackWriteBusyError) {
        return this.fail(task, 'write_in_progress', error.message, { tagWriteStatus: 'failed' });
      }
      if (error instanceof Kid3Error) {
        const code = error.kind === 'not_found'
          ? 'kid3_not_found'
          : error.kind === 'verification' ? 'verification_failed' : 'kid3_failed';
        return this.fail(task, code, error.message, { tagWriteStatus: 'failed' });
      }
      return this.fail(task, 'kid3_failed', '同步歌词标签写入失败', { tagWriteStatus: 'failed' });
    }
  }

  private update(task: OnlineLyricsTask, patch: Partial<OnlineLyricsTask>): OnlineLyricsTask {
    const next = { ...task, ...patch, updatedAt: Date.now() };
    this.database.saveOnlineLyricsTask(next);
    return next;
  }

  private fail(
    task: OnlineLyricsTask,
    code: OnlineLyricsErrorCode,
    message: string,
    patch: Partial<OnlineLyricsTask> = {},
  ): OnlineLyricsTask {
    logger.warn(`[task:${task.id}] ${code}: ${message}`);
    return this.update(task, {
      ...patch,
      status: 'failed',
      error: taskError(code, message),
    });
  }
}
