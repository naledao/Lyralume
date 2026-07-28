import { randomUUID } from 'node:crypto';
import type {
  BilingualLyricsErrorCode,
  BilingualLyricsStartOptions,
  BilingualLyricsTask,
  BilingualLyricsTaskError,
  BilingualLyricsTaskStatus,
  BilingualLyricsTranslationStyle,
  LyricsTaskStatusOverride,
} from '../../shared/contracts.js';
import { parseLrc } from '../../shared/lrc.js';
import { LibraryDatabase } from '../library/database.js';
import { LibraryService } from '../library/service.js';
import { logger } from '../logging.js';
import { TrackWriteBusyError, TrackWriteCoordinator } from '../track-write-coordinator.js';
import {
  CodexBilingualError,
  CodexSdkBilingualTranslator,
  type BilingualLyricsTranslator,
  type BilingualTranslationInputLine,
  type BilingualTranslationStage,
} from './codex-bilingual-translator.js';
import { Kid3Adapter, Kid3Error } from './kid3.js';
import { loadPreferredLyricsSource } from './lyrics-source.js';

const ACTIVE_STATUSES = new Set<BilingualLyricsTaskStatus>([
  'analyzing',
  'researching',
  'translating',
]);
const STYLES = new Set<BilingualLyricsTranslationStyle>(['natural', 'lyrical', 'singable']);
const TASK_ID_PATTERN = /^[a-f0-9-]{36}$/;

type TaskListener = (task: BilingualLyricsTask) => void;

class BilingualSourceChangedError extends Error {
  constructor() {
    super('生成草稿后原歌词发生变化，请重新译配后再写入 MP3');
    this.name = 'BilingualSourceChangedError';
  }
}

function formatTimestamp(seconds: number): string {
  const centiseconds = Math.max(0, Math.round(seconds * 100));
  const minutes = Math.floor(centiseconds / 6000);
  const remainder = centiseconds % 6000;
  return `[${String(minutes).padStart(2, '0')}:${String(Math.floor(remainder / 100)).padStart(2, '0')}.${String(remainder % 100).padStart(2, '0')}]`;
}

export function bilingualLinesToLrc(lines: BilingualLyricsTask['lines']): string {
  const output = lines.flatMap((line) => {
    if (!Number.isFinite(line.time) || line.time < 0) return [];
    const timestamp = formatTimestamp(line.time);
    const originalText = line.originalText.replace(/[\r\n\0]+/g, ' ').trim();
    const translatedText = line.translatedText.replace(/[\r\n\0]+/g, ' ').trim();
    return [originalText, translatedText]
      .filter(Boolean)
      .map((text) => `${timestamp}${text}`);
  });
  if (output.length === 0) throw new Error('双语草稿不包含可写入的同步歌词');
  return `${output.join('\n')}\n`;
}

function taskError(code: BilingualLyricsErrorCode, message: string): BilingualLyricsTaskError {
  return { code, message };
}

function idleTask(trackId: string): BilingualLyricsTask {
  const now = Date.now();
  return {
    id: `bilingual-idle-${trackId}`,
    trackId,
    status: 'idle',
    progress: 0,
    message: '尚未生成中文双语歌词',
    targetLanguage: 'zh-CN',
    style: 'lyrical',
    lines: [],
    sources: [],
    tagWriteStatus: 'not_started',
    createdAt: now,
    updatedAt: now,
  };
}

function statusForStage(stage: BilingualTranslationStage): {
  status: BilingualLyricsTaskStatus;
  progress: number;
} {
  if (stage === 'researching') return { status: 'researching', progress: 0.4 };
  if (stage === 'translating') return { status: 'translating', progress: 0.72 };
  return { status: 'analyzing', progress: 0.15 };
}

function errorFromCodex(error: unknown): BilingualLyricsTaskError {
  if (error instanceof CodexBilingualError) {
    if (error.code === 'unavailable') return taskError('codex_unavailable', error.message);
    if (error.code === 'invalid_response') return taskError('invalid_response', error.message);
    return taskError('codex_failed', error.message);
  }
  return taskError(
    'codex_failed',
    error instanceof Error ? error.message : 'Codex 双语译配失败',
  );
}

export class BilingualLyricsService {
  private readonly activeTasks = new Map<string, AbortController>();
  private readonly initializedTasks = new Set<string>();
  private readonly executions = new Set<Promise<BilingualLyricsTask>>();
  private listener?: TaskListener;

  constructor(
    private readonly database: LibraryDatabase,
    private readonly library: Pick<LibraryService, 'refreshSnapshot'>,
    private readonly kid3: Pick<Kid3Adapter, 'writeLyricsAndVerify'>,
    private readonly translator: BilingualLyricsTranslator = new CodexSdkBilingualTranslator(),
    private readonly trackWrites = new TrackWriteCoordinator(),
  ) {}

  setListener(listener: TaskListener): void {
    this.listener = listener;
  }

  getTask(trackId: string): BilingualLyricsTask {
    if (!this.database.getTrackLocation(trackId)) {
      return {
        ...idleTask(trackId),
        status: 'failed',
        message: '音乐库中找不到这首歌曲',
        error: taskError('track_not_found', '音乐库中找不到这首歌曲'),
      };
    }
    const firstRead = !this.initializedTasks.has(trackId);
    this.initializedTasks.add(trackId);
    const stored = this.database.getBilingualLyricsTask(trackId);
    if (!stored || !TASK_ID_PATTERN.test(stored.id)) return idleTask(trackId);
    const normalized: BilingualLyricsTask = {
      ...stored,
      tagWriteStatus: stored.tagWriteStatus ?? 'not_started',
    };
    if (firstRead && ACTIVE_STATUSES.has(normalized.status) && !this.activeTasks.has(trackId)) {
      return this.update(normalized, {
        status: 'failed',
        message: '上次 Codex 译配在应用退出前未完成',
        error: taskError(
          'task_interrupted',
          '上次任务被应用退出中断；原歌词和已经保存的旧草稿均未被修改',
        ),
      });
    }
    if (firstRead && normalized.tagWriteStatus === 'writing') {
      return this.update(normalized, {
        status: normalized.lines.length > 0 ? 'review' : 'failed',
        message: '上次写入 MP3 的任务在应用退出前未完成',
        tagWriteStatus: 'failed',
        error: taskError('task_interrupted', '双语草稿已保留，可以重新执行写入和回读验证'),
      });
    }
    return normalized;
  }

  getTasks(): BilingualLyricsTask[] {
    return this.database.getBilingualLyricsTasks()
      .map((task) => this.getTask(task.trackId))
      .filter((task) => task.status !== 'idle')
      .sort((left, right) => right.updatedAt - left.updatedAt);
  }

  setStatusOverride(
    trackId: string,
    statusOverride: LyricsTaskStatusOverride | null,
  ): BilingualLyricsTask {
    const task = this.getTask(trackId);
    if (task.status === 'idle') throw new Error('当前歌曲还没有中文译配任务');
    if (this.activeTasks.has(trackId) || ACTIVE_STATUSES.has(task.status) || task.tagWriteStatus === 'writing') {
      throw new Error('运行中的任务不能强制改状态，请先取消任务');
    }
    return this.update(task, { statusOverride: statusOverride ?? undefined });
  }

  async start(
    trackId: string,
    options: BilingualLyricsStartOptions = {},
  ): Promise<BilingualLyricsTask> {
    const track = this.database.getTrackLocation(trackId);
    if (!track) return this.getTask(trackId);
    if (this.activeTasks.has(trackId)) {
      const current = this.getTask(trackId);
      return {
        ...current,
        error: taskError('task_in_progress', '这首歌曲已有 Codex 双语译配任务正在运行'),
      };
    }
    const style = options.style ?? 'lyrical';
    if (!STYLES.has(style)) {
      return {
        ...idleTask(trackId),
        status: 'failed',
        message: '双语译配风格无效',
        error: taskError('invalid_request', '双语译配风格无效'),
      };
    }

    const source = await loadPreferredLyricsSource(track);
    if (!source) {
      return this.saveFailure(trackId, style, 'lyrics_missing', '没有可供翻译的同步歌词');
    }
    const parsed = parseLrc(source.raw);
    if (parsed.lines.length === 0 || parsed.lines.every((line) => !line.text.trim())) {
      return this.saveFailure(trackId, style, 'invalid_lrc', '同步歌词中没有可翻译的有效文本行');
    }

    const now = Date.now();
    const task: BilingualLyricsTask = {
      id: randomUUID(),
      trackId,
      status: 'analyzing',
      progress: 0.08,
      message: '正在准备 Codex 双语译配',
      targetLanguage: 'zh-CN',
      style,
      sourceRevision: source.revision,
      lines: [],
      sources: [],
      tagWriteStatus: 'not_started',
      createdAt: now,
      updatedAt: now,
    };
    const inputLines: BilingualTranslationInputLine[] = parsed.lines.map((line) => ({
      id: line.id,
      time: line.time,
      text: line.text,
    }));
    const controller = new AbortController();
    this.initializedTasks.add(trackId);
    this.activeTasks.set(trackId, controller);
    this.update(task, {});

    const execution = this.runTranslation(task, inputLines, controller);
    this.executions.add(execution);
    try {
      return await execution;
    } finally {
      this.executions.delete(execution);
      this.activeTasks.delete(trackId);
    }
  }

  cancel(trackId: string): BilingualLyricsTask {
    const current = this.getTask(trackId);
    const controller = this.activeTasks.get(trackId);
    if (!controller) return current;
    controller.abort();
    return this.update(current, {
      status: 'cancelled',
      message: '已取消 Codex 双语译配，原歌词未被修改',
      error: taskError('cancelled', '任务已由用户取消'),
    });
  }

  async writeTag(trackId: string): Promise<BilingualLyricsTask> {
    const execution = this.runTagWrite(trackId);
    this.executions.add(execution);
    try {
      return await execution;
    } finally {
      this.executions.delete(execution);
    }
  }

  async close(): Promise<void> {
    for (const [trackId, controller] of this.activeTasks) {
      controller.abort();
      const current = this.database.getBilingualLyricsTask(trackId);
      if (current && ACTIVE_STATUSES.has(current.status)) {
        this.update(current, {
          status: 'failed',
          message: '应用退出，Codex 双语译配已中断',
          error: taskError('task_interrupted', '应用退出前任务尚未完成'),
        });
      }
    }
    await Promise.all([...this.executions].map((execution) => execution.catch(() => idleTask('closed'))));
  }

  private async runTranslation(
    initialTask: BilingualLyricsTask,
    inputLines: BilingualTranslationInputLine[],
    controller: AbortController,
  ): Promise<BilingualLyricsTask> {
    try {
      const track = this.database.getTrackLocation(initialTask.trackId);
      if (!track) {
        return this.update(initialTask, {
          status: 'failed',
          message: '音乐库中找不到这首歌曲',
          error: taskError('track_not_found', '音乐库中找不到这首歌曲'),
        });
      }
      const result = await this.translator.translate({
        title: track.title,
        artist: track.artist,
        album: track.album,
        style: initialTask.style,
        lines: inputLines,
      }, controller.signal, (stage, message, detail) => {
        if (controller.signal.aborted) return;
        const current = this.database.getBilingualLyricsTask(initialTask.trackId) ?? initialTask;
        const state = statusForStage(stage);
        this.update(current, {
          ...state,
          message: detail ? `${message} · ${detail}` : message,
          error: undefined,
        });
      });

      const latestTrack = this.database.getTrackLocation(initialTask.trackId);
      const latestSource = latestTrack ? await loadPreferredLyricsSource(latestTrack) : undefined;
      if (!latestSource || latestSource.revision !== initialTask.sourceRevision) {
        const current = this.database.getBilingualLyricsTask(initialTask.trackId) ?? initialTask;
        return this.update(current, {
          status: 'failed',
          message: '翻译期间原歌词发生变化，已丢弃本次结果',
          error: taskError('source_changed', '请重新开始译配，以免双语行与当前歌词错位'),
        });
      }

      const current = this.database.getBilingualLyricsTask(initialTask.trackId) ?? initialTask;
      return this.update(current, {
        status: 'review',
        progress: 1,
        message: '中文双语草稿已生成，等待人工审阅',
        lines: result.lines.map((line) => ({
          id: line.id,
          time: line.time,
          originalText: line.originalText,
          translatedText: line.translatedText,
        })),
        summary: result.summary,
        sources: result.sources,
        tagWriteStatus: 'not_started',
        error: undefined,
      });
    } catch (error) {
      const current = this.database.getBilingualLyricsTask(initialTask.trackId) ?? initialTask;
      if (controller.signal.aborted) {
        if (current.status === 'cancelled' || current.error?.code === 'task_interrupted') return current;
        return this.update(current, {
          status: 'cancelled',
          message: 'Codex 双语译配已取消，原歌词未被修改',
          error: taskError('cancelled', '任务已取消'),
        });
      }
      const taskFailure = errorFromCodex(error);
      logger.warn(`[task:${initialTask.id}] Codex bilingual translation failed`, error);
      return this.update(current, {
        status: 'failed',
        message: taskFailure.message,
        error: taskFailure,
      });
    }
  }

  private async runTagWrite(trackId: string): Promise<BilingualLyricsTask> {
    const track = this.database.getTrackLocation(trackId);
    if (!track) return this.getTask(trackId);
    let task = this.getTask(trackId);
    if (task.status !== 'review' || task.lines.length === 0 || !task.sourceRevision) {
      return this.update(task, {
        message: '请先生成并审阅中文双语草稿',
        error: taskError('invalid_request', '请先生成并审阅中文双语草稿'),
      });
    }
    if (this.trackWrites.isBusy(trackId)) {
      return this.writeFailure(task, 'write_in_progress', '这首歌曲已有文件写入任务正在运行');
    }

    let raw: string;
    try {
      raw = bilingualLinesToLrc(task.lines);
    } catch (error) {
      return this.writeFailure(
        task,
        'invalid_lrc',
        error instanceof Error ? error.message : '双语草稿无法转换为同步歌词',
      );
    }

    task = this.update(task, {
      message: '正在把双语同步歌词写入 MP3 并回读验证',
      tagWriteStatus: 'writing',
      error: undefined,
    });
    logger.info(`[task:${task.id}] Writing bilingual synchronized lyrics with kid3-cli`);
    try {
      await this.trackWrites.run(trackId, async () => {
        const latestTrack = this.database.getTrackLocation(trackId);
        const latestSource = latestTrack ? await loadPreferredLyricsSource(latestTrack) : undefined;
        if (!latestSource || latestSource.revision !== task.sourceRevision) {
          throw new BilingualSourceChangedError();
        }
        await this.kid3.writeLyricsAndVerify(
          track.filePath,
          raw,
          'Lyralume / Bilingual zh-CN',
        );
      });
      this.database.setTrackEmbeddedLyrics(trackId, true);
      this.database.setTrackPreferEmbeddedLyrics(trackId, true);
      this.library.refreshSnapshot();
      task = this.update(task, {
        message: '双语同步歌词已写入 MP3 并通过回读验证',
        tagWriteStatus: 'verified',
        error: undefined,
      });
      logger.info(`[task:${task.id}] Bilingual SYLT write and readback verification completed`);
      return task;
    } catch (error) {
      if (error instanceof TrackWriteBusyError) {
        return this.writeFailure(task, 'write_in_progress', error.message);
      }
      if (error instanceof BilingualSourceChangedError) {
        return this.writeFailure(task, 'source_changed', error.message);
      }
      if (error instanceof Kid3Error) {
        const code: BilingualLyricsErrorCode = error.kind === 'not_found'
          ? 'kid3_not_found'
          : error.kind === 'verification' ? 'verification_failed' : 'kid3_failed';
        return this.writeFailure(task, code, error.message);
      }
      return this.writeFailure(task, 'kid3_failed', '双语同步歌词标签写入失败');
    }
  }

  private saveFailure(
    trackId: string,
    style: BilingualLyricsTranslationStyle,
    code: BilingualLyricsErrorCode,
    message: string,
  ): BilingualLyricsTask {
    const now = Date.now();
    const task: BilingualLyricsTask = {
      id: randomUUID(),
      trackId,
      status: 'failed',
      progress: 0,
      message,
      targetLanguage: 'zh-CN',
      style,
      lines: [],
      sources: [],
      tagWriteStatus: 'not_started',
      error: taskError(code, message),
      createdAt: now,
      updatedAt: now,
    };
    this.initializedTasks.add(trackId);
    return this.update(task, {});
  }

  private writeFailure(
    task: BilingualLyricsTask,
    code: BilingualLyricsErrorCode,
    message: string,
  ): BilingualLyricsTask {
    logger.warn(`[task:${task.id}] ${code}: ${message}`);
    return this.update(task, {
      status: task.lines.length > 0 ? 'review' : 'failed',
      message,
      tagWriteStatus: 'failed',
      error: taskError(code, message),
    });
  }

  private update(
    task: BilingualLyricsTask,
    patch: Partial<BilingualLyricsTask>,
  ): BilingualLyricsTask {
    const next = { ...task, ...patch, updatedAt: Date.now() };
    this.database.saveBilingualLyricsTask(next);
    this.listener?.(next);
    return next;
  }
}
