import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, open, readFile, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import type {
  LocalLyricsDraftUpdate,
  LocalLyricsErrorCode,
  LocalLyricsModelSettings,
  LocalLyricsProofreadProgress,
  LocalLyricsProofreadResult,
  LocalLyricsStage,
  LocalLyricsStartOptions,
  LocalLyricsTask,
  LocalLyricsTaskError,
  LyricsTaskStatusOverride,
} from '../../shared/contracts.js';
import {
  normalizeTrackLanguage,
  toWhisperLanguageCode,
} from '../../shared/track-language.js';
import { LibraryDatabase } from '../library/database.js';
import { LibraryService } from '../library/service.js';
import { logger } from '../logging.js';
import { TrackWriteBusyError, TrackWriteCoordinator } from '../track-write-coordinator.js';
import { Kid3Adapter, Kid3Error } from '../lyrics/kid3.js';
import { LrcSaveError, saveLrcAtomically } from '../lyrics/safe-lrc.js';
import { compileAlignmentToDraft, DraftValidationError, draftToLrc, validateDraftUpdate } from './draft-compiler.js';
import {
  CodexCliProofreader,
  CodexProofreadError,
  type LocalLyricsProofreader,
} from './codex-proofreader.js';
import { LocalLyricsModelSettingsStore } from './model-settings.js';
import type { LocalLyricsWorkerGateway } from './worker-gateway.js';
import { LOCAL_LYRICS_WORKER_PROTOCOL_VERSION, type WorkerProgressMessage } from './worker-protocol.js';
import { WorkerExecutionError } from './worker-process.js';

const ACTIVE_STATUSES = new Set<LocalLyricsTask['status']>([
  'queued',
  'separating',
  'transcribing',
  'compiling',
  'saving_draft',
  'saving_lrc',
  'writing_tag',
]);
const TASK_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DEFAULT_UVR_MODEL_NAME = 'model_bs_roformer_ep_317_sdr_12.9755.ckpt';

interface ActiveTask {
  taskId: string;
  controller: AbortController;
}

interface TaskArtifacts {
  directory: string;
  manifest: string;
  vocals: string;
  transcript: string;
  alignment: string;
  draftJson: string;
  draftLrc: string;
}

export interface LocalLyricsRuntimeOptions {
  cacheRoot: string;
  modelRoot: string;
  modelSettingsPath?: string;
  defaultDevice?: 'cuda' | 'cpu';
  uvrModelName?: string;
  whisperModelName?: string;
  whisperBatchSize?: number;
}

type TaskListener = (task: LocalLyricsTask) => void;

function idleTask(trackId: string): LocalLyricsTask {
  const now = Date.now();
  return {
    id: `local-${trackId}`,
    trackId,
    status: 'idle',
    stage: 'pending',
    progress: 0,
    message: '尚未创建本地歌词草稿',
    draftLines: [],
    draftOffsetMs: 0,
    lowConfidenceCount: 0,
    lrcSaveStatus: 'not_started',
    tagWriteStatus: 'not_started',
    createdAt: now,
    updatedAt: now,
  };
}

function taskError(
  code: LocalLyricsErrorCode,
  message: string,
  stage?: LocalLyricsStage,
): LocalLyricsTaskError {
  return { code, message, stage };
}

function lowConfidenceCount(lines: LocalLyricsTask['draftLines']): number {
  return lines.filter((line) => line.flags.length > 0).length;
}

async function atomicWrite(filePath: string, value: string): Promise<void> {
  const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  let handle;
  try {
    handle = await open(temporaryPath, 'wx', 0o600);
    await handle.writeFile(value, 'utf8');
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(temporaryPath, filePath);
  } finally {
    await handle?.close().catch(() => undefined);
    await rm(temporaryPath, { force: true }).catch(() => undefined);
  }
}

export class LocalLyricsService {
  private readonly activeTasks = new Map<string, ActiveTask>();
  private readonly initializedTasks = new Set<string>();
  private readonly checkpointQueues = new Map<string, Promise<void>>();
  private pipelineQueue: Promise<void> = Promise.resolve();
  private activeProofread?: AbortController;
  private readonly modelSettings: LocalLyricsModelSettingsStore;
  private listener?: TaskListener;

  constructor(
    private readonly database: LibraryDatabase,
    private readonly library: LibraryService,
    private readonly workers: LocalLyricsWorkerGateway,
    private readonly kid3: Kid3Adapter,
    private readonly runtime: LocalLyricsRuntimeOptions,
    private readonly trackWrites = new TrackWriteCoordinator(),
    private readonly proofreader: LocalLyricsProofreader = new CodexCliProofreader(),
  ) {
    const managedModelPath = path.join(
      runtime.modelRoot,
      'uvr',
      runtime.uvrModelName ?? DEFAULT_UVR_MODEL_NAME,
    );
    this.modelSettings = new LocalLyricsModelSettingsStore(
      runtime.modelSettingsPath ?? path.join(runtime.modelRoot, 'local-lyrics-settings.json'),
      managedModelPath,
    );
  }

  setListener(listener: TaskListener): void {
    this.listener = listener;
  }

  getModelSettings(): Promise<LocalLyricsModelSettings> {
    return this.modelSettings.get();
  }

  async setCustomUvrModel(filePath: string): Promise<LocalLyricsModelSettings> {
    this.assertModelSettingsEditable();
    return this.modelSettings.setCustomUvrModel(filePath);
  }

  async resetUvrModel(): Promise<LocalLyricsModelSettings> {
    this.assertModelSettingsEditable();
    return this.modelSettings.resetUvrModel();
  }

  getTask(trackId: string): LocalLyricsTask {
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
    const stored = this.database.getLocalLyricsTask(trackId);
    if (!stored || !TASK_ID_PATTERN.test(stored.id)) return idleTask(trackId);
    if (firstRead && ACTIVE_STATUSES.has(stored.status) && !this.activeTasks.has(trackId)) {
      const interrupted = this.update(stored, {
        status: 'failed',
        message: '上次任务在应用退出前未完成，已保留完成的中间结果',
        error: taskError(
          'task_interrupted',
          '上次任务在应用退出前未完成；可以重新生成，已有中间文件不会被删除',
          stored.stage,
        ),
      });
      void this.checkpoint(interrupted).catch((error) => {
        logger.warn(`[task:${interrupted.id}] Unable to update interrupted manifest`, error);
      });
      return interrupted;
    }
    return stored;
  }

  getTasks(): LocalLyricsTask[] {
    return this.database.getLocalLyricsTasks()
      .map((task) => this.getTask(task.trackId))
      .filter((task) => task.status !== 'idle')
      .sort((left, right) => right.updatedAt - left.updatedAt);
  }

  async setStatusOverride(
    trackId: string,
    statusOverride: LyricsTaskStatusOverride | null,
  ): Promise<LocalLyricsTask> {
    const task = this.getTask(trackId);
    if (task.status === 'idle') throw new Error('当前歌曲还没有本机歌词任务');
    if (this.activeTasks.has(trackId) || ACTIVE_STATUSES.has(task.status)) {
      throw new Error('运行中的任务不能强制改状态，请先取消任务');
    }
    const updated = this.update(task, { statusOverride: statusOverride ?? undefined });
    await this.checkpoint(updated);
    return updated;
  }

  async start(trackId: string, options: LocalLyricsStartOptions = {}): Promise<LocalLyricsTask> {
    const track = this.database.getTrackLocation(trackId);
    if (!track) return this.getTask(trackId);
    const running = this.activeTasks.get(trackId);
    if (running) {
      const current = this.database.getLocalLyricsTask(trackId) ?? idleTask(trackId);
      return {
        ...current,
        error: taskError('task_in_progress', '这首歌曲已有本地歌词任务正在运行', current.stage),
      };
    }
    const requestedLanguage = options.language?.trim();
    const language = requestedLanguage
      ? toWhisperLanguageCode(normalizeTrackLanguage(requestedLanguage)) ?? requestedLanguage
      : toWhisperLanguageCode(track.language);
    if (language && !/^[a-z]{2,3}(?:-[A-Z]{2})?$/.test(language)) {
      return {
        ...idleTask(trackId),
        status: 'failed',
        message: '语言代码格式无效',
        error: taskError('invalid_request', '语言代码格式无效'),
      };
    }

    const now = Date.now();
    const task: LocalLyricsTask = {
      id: randomUUID(),
      trackId,
      status: 'queued',
      stage: 'pending',
      progress: 0,
      message: '已加入本地 AI 串行队列',
      language: language || undefined,
      draftLines: [],
      draftOffsetMs: 0,
      lowConfidenceCount: 0,
      lrcSaveStatus: 'not_started',
      tagWriteStatus: 'not_started',
      createdAt: now,
      updatedAt: now,
    };
    const controller = new AbortController();
    this.activeTasks.set(trackId, { taskId: task.id, controller });
    await mkdir(this.artifacts(task.id).directory, { recursive: true });
    this.update(task, {});
    await this.checkpoint(task);

    this.pipelineQueue = this.pipelineQueue
      .then(() => this.runPipeline(task.id, trackId, options, controller))
      .catch((error) => logger.error(`[task:${task.id}] Unhandled local lyrics pipeline error`, error));
    return task;
  }

  async cancel(trackId: string): Promise<LocalLyricsTask> {
    const active = this.activeTasks.get(trackId);
    const task = this.getTask(trackId);
    if (!active || active.taskId !== task.id || !ACTIVE_STATUSES.has(task.status)) return task;
    active.controller.abort();
    const cancelled = this.update(task, {
      status: 'cancelled',
      message: '任务已取消，完成的中间结果已保留',
      error: undefined,
    });
    await this.checkpoint(cancelled);
    return cancelled;
  }

  async proofread(
    trackId: string,
    update: LocalLyricsDraftUpdate,
    onProgress?: (progress: LocalLyricsProofreadProgress) => void,
  ): Promise<LocalLyricsProofreadResult> {
    const track = this.database.getTrackLocation(trackId);
    if (!track) throw new Error('音乐库中找不到这首歌曲');
    const task = this.getTask(trackId);
    if (task.draftLines.length === 0) throw new Error('当前歌曲还没有可校对的歌词草稿');
    if (this.activeProofread) throw new Error('已有 Codex 歌词校对任务正在运行');
    const validated = validateDraftUpdate(update);
    if (validated.lines.length > 2_000) throw new Error('Codex 校对最多支持 2000 行歌词');

    const controller = new AbortController();
    const startedAt = Date.now();
    const emitProgress = (
      stage: LocalLyricsProofreadProgress['stage'],
      message: string,
      detail?: string,
    ): void => {
      const timestamp = Date.now();
      onProgress?.({
        trackId,
        stage,
        message,
        detail: detail?.replace(/[\r\n\0]+/g, ' ').trim().slice(0, 500) || undefined,
        elapsedMs: Math.max(0, timestamp - startedAt),
        timestamp,
      });
    };
    this.activeProofread = controller;
    logger.info(`[task:${task.id}] Starting isolated Codex draft proofreading`);
    emitProgress('preparing', `正在准备 ${validated.lines.length} 行歌词草稿`);
    try {
      const result = await this.proofreader.proofread({
        title: track.title,
        artist: track.artist,
        album: track.album,
        language: task.language,
        offsetMs: validated.offsetMs,
        lines: validated.lines.map((line) => ({
          id: line.id,
          startTime: line.startTime,
          endTime: line.endTime,
          text: line.text,
          confidence: line.confidence,
          flags: line.flags,
        })),
      }, controller.signal, (progress) => {
        emitProgress(progress.stage, progress.message, progress.detail);
      });
      emitProgress('validating', '正在验证时间顺序、行 ID 和联网来源');
      const originalById = new Map(validated.lines.map((line) => [line.id, line]));
      const correctedUpdate = validateDraftUpdate({
        offsetMs: result.offsetMs,
        lines: result.lines.map((line) => {
          const original = originalById.get(line.id);
          return {
            ...line,
            confidence: original?.confidence ?? null,
            flags: original ? [...original.flags] : ['low_confidence' as const],
            ...(original?.tokens ? { tokens: original.tokens.map((token) => ({ ...token })) } : {}),
          };
        }),
      });
      const outputIds = new Set(correctedUpdate.lines.map((line) => line.id));
      const changedOrAdded = correctedUpdate.lines.filter((line) => {
        const original = originalById.get(line.id);
        return !original
          || line.text !== original.text
          || line.startTime !== original.startTime
          || line.endTime !== original.endTime;
      }).length;
      const removed = validated.lines.filter((line) => !outputIds.has(line.id)).length;
      const changedLineCount = changedOrAdded + removed;
      logger.info(`[task:${task.id}] Codex proofreading proposed ${changedLineCount} changed lines`);
      emitProgress(
        'completed',
        'Codex 校对建议已通过验证',
        `共检测到 ${changedLineCount} 项行级变化，等待你确认保存`,
      );
      return {
        lines: correctedUpdate.lines,
        offsetMs: correctedUpdate.offsetMs,
        changedLineCount,
        summary: result.summary.trim().slice(0, 1_000) || '已完成联网歌词校对',
        sources: result.sources,
      };
    } catch (error) {
      logger.warn(`[task:${task.id}] Codex draft proofreading failed`, error);
      emitProgress(
        'failed',
        'Codex 联网校对失败',
        error instanceof Error ? error.message : '未知错误',
      );
      if (error instanceof CodexProofreadError || error instanceof DraftValidationError) throw error;
      throw new Error(error instanceof Error ? error.message : 'Codex 歌词校对失败');
    } finally {
      if (this.activeProofread === controller) this.activeProofread = undefined;
    }
  }

  async saveDraft(trackId: string, update: LocalLyricsDraftUpdate): Promise<LocalLyricsTask> {
    let task = this.getTask(trackId);
    if (task.status === 'idle' || task.draftLines.length === 0) {
      return {
        ...task,
        status: 'failed',
        message: '当前歌曲还没有可保存的本地歌词草稿',
        error: taskError('invalid_request', '当前歌曲还没有可保存的本地歌词草稿'),
        updatedAt: Date.now(),
      };
    }
    try {
      const validated = validateDraftUpdate(update);
      task = this.update(task, {
        status: 'saving_draft',
        stage: 'draft',
        message: '正在保存校对草稿',
        error: undefined,
      });
      const artifacts = this.artifacts(task.id);
      await atomicWrite(artifacts.draftJson, `${JSON.stringify({
        schemaVersion: 1,
        taskId: task.id,
        ...validated,
      }, null, 2)}\n`);
      await atomicWrite(artifacts.draftLrc, draftToLrc(validated, true));
      task = this.update(task, {
        status: 'review',
        progress: 1,
        message: '草稿已保存，仍需用户确认',
        draftLines: validated.lines,
        draftOffsetMs: validated.offsetMs,
        lowConfidenceCount: lowConfidenceCount(validated.lines),
        error: undefined,
      });
      await this.checkpoint(task);
      return task;
    } catch (error) {
      return this.fail(
        task,
        error instanceof DraftValidationError ? 'invalid_draft' : 'save_failed',
        error instanceof Error ? error.message : '歌词草稿保存失败',
        'draft',
      );
    }
  }

  async confirmLrc(
    trackId: string,
    update: LocalLyricsDraftUpdate,
    overwriteExisting = false,
  ): Promise<LocalLyricsTask> {
    let task = await this.saveDraft(trackId, update);
    if (task.status !== 'review') return task;
    const track = this.database.getTrackLocation(trackId);
    if (!track) return this.fail(task, 'track_not_found', '音乐库中找不到这首歌曲');
    if (task.draftLines.some((line) => line.flags.includes('missing_timing'))) {
      return this.fail(task, 'invalid_draft', '仍有缺少时间的歌词行，请校正时间后再确认', 'confirmation');
    }
    task = this.update(task, {
      status: 'saving_lrc',
      stage: 'confirmation',
      message: '正在原子保存正式 LRC',
      lrcSaveStatus: 'saving',
      error: undefined,
    });
    try {
      const raw = draftToLrc({ lines: task.draftLines, offsetMs: task.draftOffsetMs });
      const lrcPath = await saveLrcAtomically(track.filePath, raw, overwriteExisting);
      this.database.setTrackLrcPath(trackId, lrcPath);
      this.library.refreshSnapshot();
      task = this.update(task, {
        status: 'lrc_saved',
        progress: 1,
        message: '正式 LRC 已保存',
        lrcFileName: path.basename(lrcPath),
        lrcSaveStatus: 'saved',
        error: undefined,
      });
      await this.checkpoint(task);
      return task;
    } catch (error) {
      if (error instanceof LrcSaveError) {
        return this.fail(
          task,
          error.kind === 'existing' ? 'existing_lrc' : 'save_failed',
          error.message,
          'confirmation',
          { lrcSaveStatus: 'failed' },
        );
      }
      return this.fail(task, 'save_failed', '正式 LRC 保存失败', 'confirmation', {
        lrcSaveStatus: 'failed',
      });
    }
  }

  async writeTag(trackId: string, update: LocalLyricsDraftUpdate): Promise<LocalLyricsTask> {
    let task = await this.saveDraft(trackId, update);
    if (task.status !== 'review') return task;
    const track = this.database.getTrackLocation(trackId);
    if (!track) return this.fail(task, 'track_not_found', '音乐库中找不到这首歌曲');
    if (task.draftLines.some((line) => line.flags.includes('missing_timing'))) {
      return this.fail(task, 'invalid_draft', '仍有缺少时间的歌词行，请校正时间后再写入标签', 'confirmation');
    }
    if (this.trackWrites.isBusy(trackId)) {
      return this.fail(task, 'write_in_progress', '这首歌曲已有文件写入任务正在运行', 'confirmation');
    }
    task = this.update(task, {
      status: 'writing_tag',
      stage: 'confirmation',
      message: '正在写入同步歌词并回读验证',
      tagWriteStatus: 'writing',
      error: undefined,
    });
    try {
      const raw = draftToLrc({ lines: task.draftLines, offsetMs: task.draftOffsetMs });
      await this.trackWrites.run(
        trackId,
        () => this.kid3.writeLyricsAndVerify(track.filePath, raw, 'Lyralume / AI Draft'),
      );
      this.database.setTrackEmbeddedLyrics(trackId, true);
      this.library.refreshSnapshot();
      task = this.update(task, {
        status: 'completed',
        progress: 1,
        message: '同步歌词已写入原音频并通过回读验证',
        tagWriteStatus: 'verified',
        error: undefined,
      });
      await this.checkpoint(task);
      return task;
    } catch (error) {
      if (error instanceof TrackWriteBusyError) {
        return this.fail(task, 'write_in_progress', error.message, 'confirmation', {
          tagWriteStatus: 'failed',
        });
      }
      if (error instanceof Kid3Error) {
        const code: LocalLyricsErrorCode = error.kind === 'not_found'
          ? 'kid3_not_found'
          : error.kind === 'verification' ? 'verification_failed' : 'kid3_failed';
        return this.fail(task, code, error.message, 'confirmation', { tagWriteStatus: 'failed' });
      }
      return this.fail(task, 'kid3_failed', '同步歌词标签写入失败', 'confirmation', {
        tagWriteStatus: 'failed',
      });
    }
  }

  getVocalsPath(taskId: string): string | undefined {
    if (!TASK_ID_PATTERN.test(taskId)) return undefined;
    const filePath = this.artifacts(taskId).vocals;
    return existsSync(filePath) ? filePath : undefined;
  }

  async close(): Promise<void> {
    this.activeProofread?.abort();
    for (const active of this.activeTasks.values()) active.controller.abort();
    await this.pipelineQueue.catch(() => undefined);
    await Promise.all([...this.checkpointQueues.values()].map((pending) => pending.catch(() => undefined)));
  }

  private async runPipeline(
    taskId: string,
    trackId: string,
    options: LocalLyricsStartOptions,
    controller: AbortController,
  ): Promise<void> {
    let task = this.database.getLocalLyricsTask(trackId);
    const track = this.database.getTrackLocation(trackId);
    if (!task || task.id !== taskId || !track) return;
    const artifacts = this.artifacts(taskId);
    const device = options.device ?? this.runtime.defaultDevice ?? 'cuda';
    try {
      if (controller.signal.aborted) throw new WorkerExecutionError('cancelled', '本地歌词任务已取消');
      const uvrModel = await this.modelSettings.get();
      if (uvrModel.uvrModelSource === 'custom' && !uvrModel.uvrModelAvailable) {
        throw new WorkerExecutionError(
          'worker',
          `自定义 UVR 模型不存在或无法读取：${uvrModel.uvrModelPath}`,
        );
      }
      task = this.update(task, {
        status: 'separating',
        stage: 'separation',
        progress: 0.02,
        message: uvrModel.uvrModelSource === 'custom'
          ? '正在加载自定义 UVR 人声分离模型'
          : '正在加载 UVR 人声分离模型',
        error: undefined,
      });
      await this.checkpoint(task);
      await this.workers.separate({
        version: LOCAL_LYRICS_WORKER_PROTOCOL_VERSION,
        type: 'request',
        action: 'separate',
        taskId,
        inputPath: track.filePath,
        outputPath: artifacts.vocals,
        modelDirectory: path.dirname(uvrModel.uvrModelPath),
        modelName: uvrModel.uvrModelName,
        modelSource: uvrModel.uvrModelSource === 'custom' ? 'external' : 'managed',
        device,
      }, controller.signal, (progress) => {
        task = this.applyWorkerProgress(task!, progress, 0.02, 0.42);
      });
      await this.assertArtifact(artifacts.vocals, 'UVR Worker 未生成人声文件');

      task = this.update(task, {
        status: 'transcribing',
        stage: 'transcription',
        progress: 0.45,
        message: '人声分离完成，UVR 已退出；正在加载 WhisperX',
        vocalsPlaybackUrl: `lyralume-media://task-vocals/${taskId}`,
      });
      await this.checkpoint(task);
      const result = await this.workers.transcribe({
        version: LOCAL_LYRICS_WORKER_PROTOCOL_VERSION,
        type: 'request',
        action: 'transcribe',
        taskId,
        inputPath: artifacts.vocals,
        transcriptPath: artifacts.transcript,
        alignmentPath: artifacts.alignment,
        modelDirectory: path.join(this.runtime.modelRoot, 'whisperx'),
        modelName: this.runtime.whisperModelName ?? 'large-v3',
        device,
        computeType: device === 'cuda' ? 'float16' : 'int8',
        batchSize: Math.max(1, Math.min(32, this.runtime.whisperBatchSize ?? 4)),
        language: task.language,
      }, controller.signal, (progress) => {
        task = this.applyWorkerProgress(task!, progress, 0.45, 0.9);
      });
      await this.assertArtifact(artifacts.transcript, 'WhisperX Worker 未保存原始转写');
      await this.assertArtifact(artifacts.alignment, 'WhisperX Worker 未保存对齐结果');

      task = this.update(task, {
        status: 'compiling',
        stage: 'draft',
        progress: 0.93,
        message: '正在把对齐结果编译为 LRC 草稿',
        language: result.language ?? task.language,
      });
      const alignment = JSON.parse(await readFile(artifacts.alignment, 'utf8')) as unknown;
      const lines = compileAlignmentToDraft(alignment);
      const draftUpdate = { lines, offsetMs: 0 };
      await atomicWrite(artifacts.draftJson, `${JSON.stringify({
        schemaVersion: 1,
        taskId,
        ...draftUpdate,
      }, null, 2)}\n`);
      await atomicWrite(artifacts.draftLrc, draftToLrc(draftUpdate, true));
      task = this.update(task, {
        status: 'review',
        stage: 'draft',
        progress: 1,
        message: '本地歌词草稿已生成，请校对后确认',
        draftLines: lines,
        draftOffsetMs: 0,
        lowConfidenceCount: lowConfidenceCount(lines),
        vocalsPlaybackUrl: `lyralume-media://task-vocals/${taskId}`,
        error: undefined,
      });
      await this.checkpoint(task);
      logger.info(`[task:${taskId}] Local lyrics draft is ready for review`);
    } catch (error) {
      const latest = this.database.getLocalLyricsTask(trackId) ?? task;
      if (controller.signal.aborted || (error instanceof WorkerExecutionError && error.kind === 'cancelled')) {
        if (latest.status !== 'cancelled') {
          task = this.update(latest, {
            status: 'cancelled',
            message: '任务已取消，完成的中间结果已保留',
            error: undefined,
          });
          await this.checkpoint(task);
        }
      } else {
        const mapped = this.mapPipelineError(error, latest.stage);
        task = this.fail(latest, mapped.code, mapped.message, latest.stage);
        await this.checkpoint(task);
      }
    } finally {
      const active = this.activeTasks.get(trackId);
      if (active?.taskId === taskId) this.activeTasks.delete(trackId);
    }
  }

  private assertModelSettingsEditable(): void {
    if (this.activeTasks.size > 0) {
      throw new Error('本地歌词任务运行期间不能更改 UVR 模型，请先取消任务');
    }
  }

  private applyWorkerProgress(
    task: LocalLyricsTask,
    progress: WorkerProgressMessage,
    start: number,
    end: number,
  ): LocalLyricsTask {
    const mapped = start + (end - start) * progress.progress;
    return this.update(task, {
      stage: progress.stage === 'separation' ? 'separation' : progress.stage,
      progress: Math.max(task.progress, mapped),
      message: progress.message,
    });
  }

  private mapPipelineError(
    error: unknown,
    stage: LocalLyricsStage,
  ): { code: LocalLyricsErrorCode; message: string } {
    if (error instanceof DraftValidationError || error instanceof SyntaxError) {
      return { code: 'invalid_alignment', message: error.message };
    }
    if (error instanceof WorkerExecutionError) {
      const code: LocalLyricsErrorCode = error.kind === 'not_configured'
        ? 'worker_not_configured'
        : error.kind === 'protocol' ? 'worker_protocol_error'
          : error.kind === 'start' ? 'worker_start_failed' : 'worker_failed';
      return { code, message: error.message };
    }
    return {
      code: stage === 'draft' ? 'invalid_alignment' : 'worker_failed',
      message: error instanceof Error ? error.message : '本地歌词任务失败',
    };
  }

  private update(task: LocalLyricsTask, patch: Partial<LocalLyricsTask>): LocalLyricsTask {
    const next = { ...task, ...patch, updatedAt: Date.now() };
    this.database.saveLocalLyricsTask(next);
    this.listener?.(next);
    return next;
  }

  private fail(
    task: LocalLyricsTask,
    code: LocalLyricsErrorCode,
    message: string,
    stage: LocalLyricsStage = task.stage,
    patch: Partial<LocalLyricsTask> = {},
  ): LocalLyricsTask {
    logger.warn(`[task:${task.id}] ${code}: ${message}`);
    const failed = this.update(task, {
      ...patch,
      status: 'failed',
      message,
      error: taskError(code, message, stage),
    });
    if (TASK_ID_PATTERN.test(failed.id)) {
      void this.checkpoint(failed).catch((error) => {
        logger.warn(`[task:${failed.id}] Unable to persist failure manifest`, error);
      });
    }
    return failed;
  }

  private artifacts(taskId: string): TaskArtifacts {
    if (!TASK_ID_PATTERN.test(taskId)) throw new Error('无效的本地歌词任务标识');
    const directory = path.join(this.runtime.cacheRoot, taskId);
    return {
      directory,
      manifest: path.join(directory, 'manifest.json'),
      vocals: path.join(directory, 'vocals.wav'),
      transcript: path.join(directory, 'raw-transcript.json'),
      alignment: path.join(directory, 'alignment.json'),
      draftJson: path.join(directory, 'draft.json'),
      draftLrc: path.join(directory, 'draft.lrc'),
    };
  }

  private async checkpoint(task: LocalLyricsTask): Promise<void> {
    if (!TASK_ID_PATTERN.test(task.id)) return;
    const previous = this.checkpointQueues.get(task.id) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(() => this.writeCheckpoint(task));
    this.checkpointQueues.set(task.id, next);
    try {
      await next;
    } finally {
      if (this.checkpointQueues.get(task.id) === next) this.checkpointQueues.delete(task.id);
    }
  }

  private async writeCheckpoint(requestedTask: LocalLyricsTask): Promise<void> {
    const stored = this.database.getLocalLyricsTask(requestedTask.trackId);
    const task = stored?.id === requestedTask.id && stored.updatedAt >= requestedTask.updatedAt
      ? stored
      : requestedTask;
    const artifacts = this.artifacts(task.id);
    const track = this.database.getTrackLocation(task.trackId);
    await mkdir(artifacts.directory, { recursive: true });
    await atomicWrite(artifacts.manifest, `${JSON.stringify({
      schemaVersion: 1,
      task,
      source: track ? {
        trackId: track.id,
        filePath: track.filePath,
        title: track.title,
        artist: track.artist,
        duration: track.duration,
      } : { trackId: task.trackId },
      artifacts: {
        vocals: 'vocals.wav',
        rawTranscript: 'raw-transcript.json',
        alignment: 'alignment.json',
        draft: 'draft.json',
        lrcDraft: 'draft.lrc',
      },
    }, null, 2)}\n`);
  }

  private async assertArtifact(filePath: string, message: string): Promise<void> {
    const info = await stat(filePath).catch(() => undefined);
    if (!info?.isFile() || info.size === 0) throw new WorkerExecutionError('worker', message);
  }
}
