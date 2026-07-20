import type {
  Track,
} from '../../shared/contracts.js';
import {
  AUDIO_ANALYSIS_VERSION,
  VISUAL_MAPPING_VERSION,
  createVisualDNA,
  type TrackVisualAnalysis,
  type VisualAnalysisProgress,
} from '../../shared/visual-analysis.js';
import { logger } from '../logging.js';
import { LibraryDatabase } from '../library/database.js';
import type { VisualAnalysisRunner } from './runner.js';

type AnalysisListener = (analysis: TrackVisualAnalysis) => void;
type ProgressListener = (progress: VisualAnalysisProgress) => void;

export class VisualAnalysisService {
  private readonly pending: string[] = [];
  private readonly pendingSet = new Set<string>();
  private runningTrackId: string | null = null;
  private closed = false;
  private analysisListener?: AnalysisListener;
  private progressListener?: ProgressListener;

  constructor(
    private readonly database: LibraryDatabase,
    private readonly runner: VisualAnalysisRunner,
  ) {}

  setListeners(onAnalysis: AnalysisListener, onProgress: ProgressListener): void {
    this.analysisListener = onAnalysis;
    this.progressListener = onProgress;
  }

  scheduleLibrary(tracks: readonly Track[]): void {
    for (const track of tracks) this.schedule(track.id);
  }

  get(trackId: string): TrackVisualAnalysis {
    const track = this.database.getTrackLocation(trackId);
    if (!track) throw new Error('音乐库中找不到这首歌曲');
    const existing = this.database.getVisualAnalysis(trackId);
    let current = existing && (
      existing.sourceSize !== track.fileSize
      || existing.sourceModifiedAt !== track.modifiedAt
      || existing.analysisVersion !== AUDIO_ANALYSIS_VERSION
    )
      ? this.database.markVisualAnalysisStale(trackId) ?? existing
      : existing;
    if (current
      && current.mappingVersion !== VISUAL_MAPPING_VERSION
      && current.profile
      && current.analysisVersion === AUDIO_ANALYSIS_VERSION
      && current.sourceSize === track.fileSize
      && current.sourceModifiedAt === track.modifiedAt) {
      current = this.remap(current);
    } else if (current && current.mappingVersion !== VISUAL_MAPPING_VERSION) {
      current = this.database.markVisualAnalysisStale(trackId) ?? current;
    }
    if (!current) {
      current = this.database.createPendingVisualAnalysis(trackId, track.fileSize, track.modifiedAt);
    }
    if (current.status === 'pending' || current.status === 'stale') this.schedule(trackId, true);
    return this.database.getVisualAnalysis(trackId) ?? current;
  }

  reanalyze(trackId: string): TrackVisualAnalysis {
    const track = this.database.getTrackLocation(trackId);
    if (!track) throw new Error('音乐库中找不到这首歌曲');
    const existing = this.database.getVisualAnalysis(trackId);
    if (existing?.status === 'running') return existing;
    const pending = this.database.createPendingVisualAnalysis(trackId, track.fileSize, track.modifiedAt);
    this.schedule(trackId, true);
    return this.database.getVisualAnalysis(trackId) ?? pending;
  }

  private schedule(trackId: string, prioritize = false): void {
    if (this.closed || this.runningTrackId === trackId) return;
    if (this.pendingSet.has(trackId)) {
      if (prioritize) {
        const index = this.pending.indexOf(trackId);
        if (index >= 0) this.pending.splice(index, 1);
        this.pending.unshift(trackId);
      }
      return;
    }
    this.pendingSet.add(trackId);
    if (prioritize) this.pending.unshift(trackId);
    else this.pending.push(trackId);
    void this.runNext();
  }

  private async runNext(): Promise<void> {
    if (this.closed || this.runningTrackId || this.pending.length === 0) return;
    const trackId = this.pending.shift();
    if (!trackId) return;
    this.pendingSet.delete(trackId);
    const track = this.database.getTrackLocation(trackId);
    if (!track) {
      this.continueQueue();
      return;
    }
    let existing = this.database.getVisualAnalysis(trackId);
    if (existing
      && existing.profile
      && existing.analysisVersion === AUDIO_ANALYSIS_VERSION
      && existing.sourceSize === track.fileSize
      && existing.sourceModifiedAt === track.modifiedAt
      && existing.mappingVersion !== VISUAL_MAPPING_VERSION) {
      existing = this.remap(existing);
      this.analysisListener?.(existing);
      this.progressListener?.({
        trackId,
        status: existing.status,
        progress: existing.progress,
        message: existing.status === 'ready' ? '歌曲视觉映射已更新' : '已更新备用视觉映射',
      });
      if (existing.status === 'ready' || existing.status === 'failed') {
        this.continueQueue();
        return;
      }
    }
    const isCurrent = (existing?.status === 'ready' || existing?.status === 'failed')
      && existing.sourceSize === track.fileSize
      && existing.sourceModifiedAt === track.modifiedAt
      && existing.analysisVersion === AUDIO_ANALYSIS_VERSION
      && existing.mappingVersion === VISUAL_MAPPING_VERSION;
    if (isCurrent) {
      this.continueQueue();
      return;
    }

    this.runningTrackId = trackId;
    const running = this.database.saveVisualAnalysis({
      ...(existing ?? this.database.createPendingVisualAnalysis(trackId, track.fileSize, track.modifiedAt)),
      status: 'running',
      progress: 0,
      sourceSize: track.fileSize,
      sourceModifiedAt: track.modifiedAt,
      analysisVersion: AUDIO_ANALYSIS_VERSION,
      mappingVersion: VISUAL_MAPPING_VERSION,
      error: undefined,
      updatedAt: Date.now(),
    });
    this.analysisListener?.(running);
    this.progressListener?.({ trackId, status: 'running', progress: 0, message: '正在分析整首歌曲' });
    logger.info(`[track:${trackId}] Started visual audio analysis`);

    try {
      let lastSavedProgress = 0;
      const result = await this.runner.analyze({
        trackId,
        filePath: track.filePath,
        durationMs: track.duration * 1_000,
      }, (progress) => {
        if (progress - lastSavedProgress < 0.02 && progress < 1) return;
        lastSavedProgress = progress;
        this.database.updateVisualAnalysisProgress(trackId, progress);
        this.progressListener?.({
          trackId,
          status: 'running',
          progress,
          message: '正在提取频谱、节拍与段落特征',
        });
      });
      if (this.discardObsoleteResult(trackId, track.fileSize, track.modifiedAt)) return;
      const visualDNA = createVisualDNA(result.profile, result.fingerprint || trackId);
      const ready = this.database.saveVisualAnalysis({
        trackId,
        status: 'ready',
        progress: 1,
        analysisVersion: AUDIO_ANALYSIS_VERSION,
        mappingVersion: VISUAL_MAPPING_VERSION,
        sourceSize: track.fileSize,
        sourceModifiedAt: track.modifiedAt,
        contentFingerprint: result.fingerprint,
        profile: result.profile,
        timeline: result.timeline,
        visualDNA,
        updatedAt: Date.now(),
      });
      this.analysisListener?.(ready);
      this.progressListener?.({ trackId, status: 'ready', progress: 1, message: '歌曲视觉分析完成' });
      logger.info(`[track:${trackId}] Completed visual audio analysis`);
    } catch (error) {
      if (this.discardObsoleteResult(trackId, track.fileSize, track.modifiedAt)) return;
      const message = error instanceof Error ? error.message : '整曲分析失败';
      const failed = this.database.saveVisualAnalysis({
        ...(this.database.getVisualAnalysis(trackId)
          ?? this.database.createPendingVisualAnalysis(trackId, track.fileSize, track.modifiedAt)),
        status: 'failed',
        error: message,
        updatedAt: Date.now(),
      });
      this.analysisListener?.(failed);
      this.progressListener?.({ trackId, status: 'failed', progress: failed.progress, message });
      logger.warn(`[track:${trackId}] Visual audio analysis failed: ${message}`);
    } finally {
      this.runningTrackId = null;
      this.continueQueue();
    }
  }

  private continueQueue(): void {
    queueMicrotask(() => void this.runNext());
  }

  private discardObsoleteResult(
    trackId: string,
    sourceSize: number,
    sourceModifiedAt: number,
  ): boolean {
    const latest = this.database.getTrackLocation(trackId);
    if (!latest) {
      logger.info(`[track:${trackId}] Discarded visual analysis because the track was removed`);
      return true;
    }
    if (latest.fileSize === sourceSize && latest.modifiedAt === sourceModifiedAt) return false;
    const pending = this.database.createPendingVisualAnalysis(
      trackId,
      latest.fileSize,
      latest.modifiedAt,
    );
    this.analysisListener?.(pending);
    if (!this.closed && !this.pendingSet.has(trackId)) {
      this.pendingSet.add(trackId);
      this.pending.unshift(trackId);
    }
    logger.info(`[track:${trackId}] Discarded stale visual analysis and queued the changed file`);
    return true;
  }

  private remap(analysis: TrackVisualAnalysis): TrackVisualAnalysis {
    if (!analysis.profile) return analysis;
    return this.database.saveVisualAnalysis({
      ...analysis,
      mappingVersion: VISUAL_MAPPING_VERSION,
      visualDNA: createVisualDNA(
        analysis.profile,
        analysis.contentFingerprint || analysis.trackId,
      ),
      updatedAt: Date.now(),
    });
  }

  async close(): Promise<void> {
    this.closed = true;
    this.pending.length = 0;
    this.pendingSet.clear();
    await this.runner.close();
  }
}
