import { create } from 'zustand';
import type {
  BilingualLyricsStartOptions,
  BilingualLyricsTask,
  LibraryRoot,
  LibrarySnapshot,
  LocalLyricsDraftUpdate,
  LocalLyricsModelSettings,
  LocalLyricsProofreadProgress,
  LocalLyricsProofreadResult,
  LocalLyricsStartOptions,
  LocalLyricsTask,
  LyricsTaskKind,
  LyricsTaskSnapshot,
  LyricsTaskStatusOverride,
  LyricsTaskTarget,
  LyricsStatus,
  OnlineLyricsTask,
  PlaybackProgress,
  PlaybackStateSnapshot,
  ScanProgress,
  Track,
  TrackMetadataUpdate,
} from '../../shared/contracts';
import { getTrackLanguageLabel } from '../../shared/contracts';
import { mergePreciseLyricTiming, parseLrc, type LyricLine } from '../../shared/lrc';

export type PlaybackMode = 'sequence' | 'shuffle' | 'repeat-one';
export type VisualQuality = 'eco' | 'balanced' | 'high';
export type AppView = 'library' | 'remote' | 'online' | 'tasks' | 'settings';

export interface TaskDetailRequest extends LyricsTaskTarget {
  requestId: number;
}

interface VisualSettings {
  quality: VisualQuality;
  intensity: number;
  reducedMotion: boolean;
}

const VISUAL_SETTINGS_STORAGE_KEY = 'lyralume.visual-settings.v1';

function defaultReducedMotion(): boolean {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function readVisualSettings(): VisualSettings {
  const fallback: VisualSettings = {
    quality: 'balanced',
    intensity: 1,
    reducedMotion: defaultReducedMotion(),
  };
  if (typeof window === 'undefined') return fallback;
  try {
    const parsed = JSON.parse(window.localStorage.getItem(VISUAL_SETTINGS_STORAGE_KEY) ?? '{}') as Partial<VisualSettings>;
    return {
      quality: parsed.quality === 'eco' || parsed.quality === 'high' ? parsed.quality : 'balanced',
      intensity: typeof parsed.intensity === 'number'
        ? Math.min(1.35, Math.max(0.35, parsed.intensity))
        : fallback.intensity,
      reducedMotion: typeof parsed.reducedMotion === 'boolean'
        ? parsed.reducedMotion
        : fallback.reducedMotion,
    };
  } catch {
    return fallback;
  }
}

function persistVisualSettings(settings: VisualSettings): void {
  try {
    window.localStorage.setItem(VISUAL_SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Settings remain active for the current session if browser storage is unavailable.
  }
}

const initialVisualSettings = readVisualSettings();

const PLAYBACK_MODES: PlaybackMode[] = ['sequence', 'shuffle', 'repeat-one'];

function shuffleQueue(queueIds: string[], currentTrackId: string | null): string[] {
  const remaining = queueIds.filter((id) => id !== currentTrackId);
  for (let index = remaining.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [remaining[index], remaining[swapIndex]] = [remaining[swapIndex], remaining[index]];
  }
  return currentTrackId && queueIds.includes(currentTrackId)
    ? [currentTrackId, ...remaining]
    : remaining;
}

function reconcileShuffleQueue(queueIds: string[], shuffledIds: string[]): string[] {
  const validIds = new Set(queueIds);
  const retained = shuffledIds.filter((id) => validIds.has(id));
  const retainedIds = new Set(retained);
  const additions = shuffleQueue(
    queueIds.filter((id) => !retainedIds.has(id)),
    null,
  );
  return [...retained, ...additions];
}

interface AppState {
  activeView: AppView;
  taskDetailRequest: TaskDetailRequest | null;
  tracks: Track[];
  roots: LibraryRoot[];
  libraryLoading: boolean;
  scanning: boolean;
  scanProgress: ScanProgress | null;
  libraryMessage: string | null;
  currentTrackId: string | null;
  queueIds: string[];
  playbackMode: PlaybackMode;
  shuffleQueueIds: string[];
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  playbackProgress: Record<string, PlaybackProgress>;
  volume: number;
  playbackError: string | null;
  lyricsStatus: LyricsStatus;
  lyricLines: LyricLine[];
  lyricOffsetMs: number;
  lyricsSource: 'lrc' | 'embedded' | null;
  lyricsRevision: string | null;
  simplifiedLyricsWriteBusy: boolean;
  lyricTimingWriteBusy: boolean;
  lyricTimingWriteError: string | null;
  lyricTimingWriteMessage: string | null;
  lyricsError: string | null;
  onlineLyricsTask: OnlineLyricsTask | null;
  onlineLyricsBusy: boolean;
  localLyricsTask: LocalLyricsTask | null;
  localLyricsTasks: Record<string, LocalLyricsTask>;
  localLyricsBusy: boolean;
  localLyricsProofreadBusy: boolean;
  localLyricsProofreadError: string | null;
  localLyricsProofreadProgress: Record<string, LocalLyricsProofreadProgress[]>;
  localLyricsModelSettings: LocalLyricsModelSettings | null;
  localLyricsModelSettingsBusy: boolean;
  localLyricsModelSettingsError: string | null;
  bilingualLyricsTask: BilingualLyricsTask | null;
  bilingualLyricsTasks: Record<string, BilingualLyricsTask>;
  bilingualLyricsBusy: boolean;
  lyricsTasksLoading: boolean;
  lyricsTasksError: string | null;
  visualsEnabled: boolean;
  visualQuality: VisualQuality;
  visualIntensity: number;
  visualReducedMotion: boolean;
  initialize(): Promise<void>;
  setActiveView(view: AppView): void;
  openLyricsTask(kind: LyricsTaskKind, trackId: string): void;
  applySnapshot(snapshot: LibrarySnapshot): void;
  applyLyricsTaskSnapshot(snapshot: LyricsTaskSnapshot): void;
  loadLyricsTasks(): Promise<void>;
  setLyricsTaskStatusOverride(
    kind: LyricsTaskKind,
    trackId: string,
    statusOverride: LyricsTaskStatusOverride | null,
  ): Promise<void>;
  applyPlaybackState(snapshot: PlaybackStateSnapshot): void;
  applyPlaybackProgress(progress: PlaybackProgress): void;
  chooseDirectory(): Promise<void>;
  importDropped(files: File[]): Promise<void>;
  updateTrackMetadata(trackId: string, metadata: TrackMetadataUpdate): Promise<boolean>;
  removeTrack(trackId: string): Promise<boolean>;
  rescan(): Promise<void>;
  setScanProgress(progress: ScanProgress): void;
  selectTrack(trackId: string, play?: boolean): void;
  togglePlayback(): void;
  setPlaying(playing: boolean): void;
  nextTrack(): void;
  previousTrack(): void;
  handleTrackEnded(): void;
  setPlaybackMode(mode: PlaybackMode): void;
  cyclePlaybackMode(): void;
  setPlaybackTime(time: number, duration?: number): void;
  setDuration(duration: number): void;
  setVolume(volume: number): void;
  setPlaybackError(message: string | null): void;
  loadLyrics(trackId: string): Promise<void>;
  loadOnlineLyricsTask(trackId: string): Promise<void>;
  searchOnlineLyrics(): Promise<void>;
  saveOnlineLyrics(candidateId: number, overwriteExisting?: boolean): Promise<void>;
  writeOnlineLyricsTag(candidateId?: number): Promise<OnlineLyricsTask | null>;
  loadLocalLyricsTask(trackId: string): Promise<void>;
  loadLocalLyricsModelSettings(): Promise<void>;
  chooseLocalUvrModel(): Promise<void>;
  resetLocalUvrModel(): Promise<void>;
  applyLocalLyricsTask(task: LocalLyricsTask): void;
  applyLocalLyricsProofreadProgress(progress: LocalLyricsProofreadProgress): void;
  startLocalLyrics(options?: LocalLyricsStartOptions): Promise<void>;
  cancelLocalLyrics(trackId?: string): Promise<void>;
  proofreadLocalLyrics(
    update: LocalLyricsDraftUpdate,
  ): Promise<LocalLyricsProofreadResult | null>;
  saveLocalLyricsDraft(update: LocalLyricsDraftUpdate): Promise<LocalLyricsTask | null>;
  confirmLocalLyricsLrc(
    update: LocalLyricsDraftUpdate,
    overwriteExisting?: boolean,
  ): Promise<LocalLyricsTask | null>;
  writeLocalLyricsTag(update: LocalLyricsDraftUpdate): Promise<LocalLyricsTask | null>;
  loadBilingualLyricsTask(trackId: string): Promise<void>;
  applyBilingualLyricsTask(task: BilingualLyricsTask): void;
  startBilingualLyrics(options?: BilingualLyricsStartOptions): Promise<void>;
  cancelBilingualLyrics(trackId?: string): Promise<void>;
  writeBilingualLyricsTag(): Promise<BilingualLyricsTask | null>;
  writeSimplifiedLyrics(): Promise<boolean>;
  writeAdjustedLyricTiming(): Promise<boolean>;
  adjustLyricOffset(deltaMs: number): void;
  resetLyricOffset(): void;
  toggleVisuals(): void;
  setVisualQuality(quality: VisualQuality): void;
  setVisualIntensity(intensity: number): void;
  setVisualReducedMotion(reducedMotion: boolean): void;
}

function normalizedQueue(snapshot: LibrarySnapshot, currentQueue: string[]): string[] {
  const validIds = new Set(snapshot.tracks.map((track) => track.id));
  const retained = currentQueue.filter((id) => validIds.has(id));
  const retainedSet = new Set(retained);
  return [...retained, ...snapshot.tracks.map((track) => track.id).filter((id) => !retainedSet.has(id))];
}

function resumeTimeForTrack(
  track: Track,
  progress: PlaybackProgress | undefined,
): number {
  if (!progress || progress.completed) return 0;
  const trackDurationMs = Math.round(Math.max(0, track.duration) * 1_000);
  if (
    progress.durationMs > 0
    && trackDurationMs > 0
    && Math.abs(progress.durationMs - trackDurationMs) > 2_000
  ) return 0;
  return Math.min(progress.positionMs / 1_000, Math.max(0, track.duration));
}

function emptyOnlineTask(trackId: string): OnlineLyricsTask {
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

function failedOnlineTask(
  trackId: string,
  current: OnlineLyricsTask | null,
  message: string,
): OnlineLyricsTask {
  return {
    ...(current ?? emptyOnlineTask(trackId)),
    status: 'failed',
    error: { code: 'service_error', message },
    updatedAt: Date.now(),
  };
}

function failedLocalTask(
  trackId: string,
  current: LocalLyricsTask | null,
  message: string,
): LocalLyricsTask {
  const now = Date.now();
  return {
    ...(current ?? {
      id: `local-${trackId}`,
      trackId,
      status: 'idle',
      stage: 'pending',
      progress: 0,
      message,
      draftLines: [],
      draftOffsetMs: 0,
      lowConfidenceCount: 0,
      lrcSaveStatus: 'not_started',
      tagWriteStatus: 'not_started',
      createdAt: now,
      updatedAt: now,
    }),
    status: 'failed',
    message,
    error: { code: 'worker_failed', message },
    updatedAt: now,
  };
}

function failedBilingualTask(
  trackId: string,
  current: BilingualLyricsTask | null,
  message: string,
): BilingualLyricsTask {
  const now = Date.now();
  return {
    ...(current ?? {
      id: `bilingual-failed-${trackId}`,
      trackId,
      status: 'idle',
      progress: 0,
      message,
      targetLanguage: 'zh-CN',
      style: 'lyrical',
      lines: [],
      sources: [],
      tagWriteStatus: 'not_started',
      createdAt: now,
      updatedAt: now,
    }),
    status: 'failed',
    message,
    error: { code: 'codex_failed', message },
    updatedAt: now,
  };
}

export const useAppStore = create<AppState>((set, get) => ({
  activeView: 'library',
  taskDetailRequest: null,
  tracks: [],
  roots: [],
  libraryLoading: true,
  scanning: false,
  scanProgress: null,
  libraryMessage: null,
  currentTrackId: null,
  queueIds: [],
  playbackMode: 'sequence',
  shuffleQueueIds: [],
  isPlaying: false,
  currentTime: 0,
  duration: 0,
  playbackProgress: {},
  volume: 0.78,
  playbackError: null,
  lyricsStatus: 'idle',
  lyricLines: [],
  lyricOffsetMs: 0,
  lyricsSource: null,
  lyricsRevision: null,
  simplifiedLyricsWriteBusy: false,
  lyricTimingWriteBusy: false,
  lyricTimingWriteError: null,
  lyricTimingWriteMessage: null,
  lyricsError: null,
  onlineLyricsTask: null,
  onlineLyricsBusy: false,
  localLyricsTask: null,
  localLyricsTasks: {},
  localLyricsBusy: false,
  localLyricsProofreadBusy: false,
  localLyricsProofreadError: null,
  localLyricsProofreadProgress: {},
  localLyricsModelSettings: null,
  localLyricsModelSettingsBusy: false,
  localLyricsModelSettingsError: null,
  bilingualLyricsTask: null,
  bilingualLyricsTasks: {},
  bilingualLyricsBusy: false,
  lyricsTasksLoading: true,
  lyricsTasksError: null,
  visualsEnabled: true,
  visualQuality: initialVisualSettings.quality,
  visualIntensity: initialVisualSettings.intensity,
  visualReducedMotion: initialVisualSettings.reducedMotion,

  initialize: async () => {
    set({
      libraryLoading: true,
      libraryMessage: null,
      lyricsTasksLoading: true,
      lyricsTasksError: null,
    });
    try {
      const [snapshot, playbackState, taskSnapshot] = await Promise.all([
        window.lyralume.library.getSnapshot(),
        window.lyralume.playback.getState().catch(() => null),
        window.lyralume.lyrics.getTasks().catch((error) => {
          set({
            lyricsTasksError: error instanceof Error ? error.message : '任务记录读取失败',
          });
          return null;
        }),
      ]);
      get().applySnapshot(snapshot);
      if (taskSnapshot) get().applyLyricsTaskSnapshot(taskSnapshot);
      if (playbackState) {
        get().applyPlaybackState(playbackState);
        if (playbackState.lastTrackId && snapshot.tracks.some(
          (track) => track.id === playbackState.lastTrackId,
        )) get().selectTrack(playbackState.lastTrackId, false);
      }
    } catch (error) {
      set({
        libraryMessage: error instanceof Error ? error.message : '音乐库载入失败',
      });
    } finally {
      set({ libraryLoading: false, lyricsTasksLoading: false });
    }
  },

  setActiveView: (activeView) => set({ activeView }),

  openLyricsTask: (kind, trackId) => {
    set((state) => ({
      activeView: 'tasks',
      taskDetailRequest: {
        kind,
        trackId,
        requestId: (state.taskDetailRequest?.requestId ?? 0) + 1,
      },
    }));
    if (get().tracks.some((track) => track.id === trackId)) {
      get().selectTrack(trackId, false);
    }
  },

  applyLyricsTaskSnapshot: (snapshot) => {
    const validTrackIds = new Set(get().tracks.map((track) => track.id));
    const localLyricsTasks = Object.fromEntries(snapshot.local
      .filter((task) => validTrackIds.has(task.trackId) && task.status !== 'idle')
      .map((task) => [task.trackId, task]));
    const bilingualLyricsTasks = Object.fromEntries(snapshot.bilingual
      .filter((task) => validTrackIds.has(task.trackId) && task.status !== 'idle')
      .map((task) => [task.trackId, task]));
    const currentTrackId = get().currentTrackId;
    set({
      localLyricsTasks,
      bilingualLyricsTasks,
      localLyricsTask: currentTrackId ? localLyricsTasks[currentTrackId] ?? null : null,
      bilingualLyricsTask: currentTrackId ? bilingualLyricsTasks[currentTrackId] ?? null : null,
      lyricsTasksError: null,
    });
  },

  loadLyricsTasks: async () => {
    set({ lyricsTasksLoading: true, lyricsTasksError: null });
    try {
      get().applyLyricsTaskSnapshot(await window.lyralume.lyrics.getTasks());
    } catch (error) {
      set({
        lyricsTasksError: error instanceof Error ? error.message : '任务记录读取失败',
      });
    } finally {
      set({ lyricsTasksLoading: false });
    }
  },

  setLyricsTaskStatusOverride: async (kind, trackId, statusOverride) => {
    set({ lyricsTasksError: null });
    try {
      const result = await window.lyralume.lyrics.setTaskStatusOverride(
        { kind, trackId },
        statusOverride,
      );
      if (result.kind === 'local') get().applyLocalLyricsTask(result.task);
      else get().applyBilingualLyricsTask(result.task);
    } catch (error) {
      set({
        lyricsTasksError: error instanceof Error ? error.message : '任务状态修改失败',
      });
    }
  },

  applySnapshot: (snapshot) => {
    const state = get();
    const queueIds = normalizedQueue(snapshot, state.queueIds);
    const shuffleQueueIds = reconcileShuffleQueue(queueIds, state.shuffleQueueIds);
    const validTrackIds = new Set(snapshot.tracks.map((track) => track.id));
    const currentStillExists = state.currentTrackId !== null && validTrackIds.has(state.currentTrackId);
    const localLyricsTasks = Object.fromEntries(
      Object.entries(state.localLyricsTasks).filter(([trackId]) => validTrackIds.has(trackId)),
    );
    const localLyricsProofreadProgress = Object.fromEntries(
      Object.entries(state.localLyricsProofreadProgress)
        .filter(([trackId]) => validTrackIds.has(trackId)),
    );
    const bilingualLyricsTasks = Object.fromEntries(
      Object.entries(state.bilingualLyricsTasks)
        .filter(([trackId]) => validTrackIds.has(trackId)),
    );
    set({
      tracks: snapshot.tracks,
      roots: snapshot.roots,
      queueIds,
      shuffleQueueIds,
      currentTrackId: currentStillExists ? state.currentTrackId : null,
      isPlaying: currentStillExists ? state.isPlaying : false,
      currentTime: currentStillExists ? state.currentTime : 0,
      duration: currentStillExists ? state.duration : 0,
      playbackError: currentStillExists ? state.playbackError : null,
      lyricsStatus: currentStillExists ? state.lyricsStatus : 'idle',
      lyricLines: currentStillExists ? state.lyricLines : [],
      lyricOffsetMs: currentStillExists ? state.lyricOffsetMs : 0,
      lyricsSource: currentStillExists ? state.lyricsSource : null,
      lyricsRevision: currentStillExists ? state.lyricsRevision : null,
      simplifiedLyricsWriteBusy: currentStillExists ? state.simplifiedLyricsWriteBusy : false,
      lyricTimingWriteBusy: currentStillExists ? state.lyricTimingWriteBusy : false,
      lyricTimingWriteError: currentStillExists ? state.lyricTimingWriteError : null,
      lyricTimingWriteMessage: currentStillExists ? state.lyricTimingWriteMessage : null,
      lyricsError: currentStillExists ? state.lyricsError : null,
      onlineLyricsTask: currentStillExists ? state.onlineLyricsTask : null,
      onlineLyricsBusy: currentStillExists ? state.onlineLyricsBusy : false,
      localLyricsTask: currentStillExists ? state.localLyricsTask : null,
      localLyricsTasks,
      localLyricsBusy: currentStillExists ? state.localLyricsBusy : false,
      localLyricsProofreadBusy: currentStillExists ? state.localLyricsProofreadBusy : false,
      localLyricsProofreadError: currentStillExists ? state.localLyricsProofreadError : null,
      localLyricsProofreadProgress,
      bilingualLyricsTask: currentStillExists ? state.bilingualLyricsTask : null,
      bilingualLyricsTasks,
      bilingualLyricsBusy: currentStillExists ? state.bilingualLyricsBusy : false,
    });
  },

  applyPlaybackState: (snapshot) => {
    set({
      playbackProgress: Object.fromEntries(
        snapshot.progress.map((progress) => [progress.trackId, progress]),
      ),
    });
  },

  applyPlaybackProgress: (progress) => {
    set((state) => ({
      playbackProgress: {
        ...state.playbackProgress,
        [progress.trackId]: progress,
      },
    }));
  },

  chooseDirectory: async () => {
    set({ scanning: true, libraryMessage: null });
    try {
      const result = await window.lyralume.library.chooseDirectory();
      if (!result) return;
      get().applySnapshot(result);
      const firstWarning = result.warnings[0];
      const warningText = firstWarning
        ? `已导入 ${result.importedTracks} 首，${result.warnings.length} 个文件无法读取：${firstWarning.fileName}（${firstWarning.message}）`
        : `已导入 ${result.importedTracks} 首歌曲`;
      set({ libraryMessage: warningText });
    } catch (error) {
      set({ libraryMessage: error instanceof Error ? error.message : '导入音乐目录失败' });
    } finally {
      set({ scanning: false, scanProgress: null });
    }
  },

  importDropped: async (files) => {
    if (files.length === 0) return;
    set({ scanning: true, libraryMessage: '正在导入拖入的音乐…' });
    try {
      const result = await window.lyralume.library.importDropped(files);
      get().applySnapshot(result);
      const firstWarning = result.warnings[0];
      set({
        libraryMessage: firstWarning
          ? `已导入 ${result.importedTracks} 首，${result.warnings.length} 个项目无法读取：${firstWarning.fileName}（${firstWarning.message}）`
          : `已导入 ${result.importedTracks} 首歌曲`,
      });
    } catch (error) {
      set({ libraryMessage: error instanceof Error ? error.message : '拖放导入失败' });
    } finally {
      set({ scanning: false, scanProgress: null });
    }
  },

  updateTrackMetadata: async (trackId, metadata) => {
    const track = get().tracks.find((item) => item.id === trackId);
    if (!track) return false;
    const languageOnly = metadata.language !== undefined && Object.keys(metadata).length === 1;
    const languageLabel = getTrackLanguageLabel(metadata.language || null);
    set({
      libraryMessage: languageOnly
        ? `正在将《${track.title}》的语种设为${languageLabel}…`
        : `正在将《${track.title}》的歌曲信息写入原文件…`,
    });
    try {
      const snapshot = await window.lyralume.library.updateMetadata(trackId, metadata);
      get().applySnapshot(snapshot);
      set({
        libraryMessage: languageOnly
          ? `已将《${track.title}》的语种设为${languageLabel}`
          : `已将《${metadata.title?.trim() || track.title}》的歌曲信息写入原文件并验证`,
      });
      return true;
    } catch (error) {
      set({
        libraryMessage: error instanceof Error
          ? error.message
          : languageOnly ? '语种保存失败' : '歌曲信息写入原文件失败',
      });
      return false;
    }
  },

  removeTrack: async (trackId) => {
    const track = get().tracks.find((item) => item.id === trackId);
    if (!track) return false;
    set({ libraryMessage: `正在从音乐库移除《${track.title}》…` });
    try {
      const snapshot = await window.lyralume.library.removeTrack(trackId);
      get().applySnapshot(snapshot);
      set({ libraryMessage: `已移除《${track.title}》，电脑上的音乐文件未删除` });
      return true;
    } catch (error) {
      set({ libraryMessage: error instanceof Error ? error.message : '移除歌曲失败' });
      return false;
    }
  },

  rescan: async () => {
    set({ scanning: true, libraryMessage: null });
    try {
      const result = await window.lyralume.library.rescan();
      get().applySnapshot(result);
      set({
        libraryMessage: result.warnings.length
          ? `扫描完成，${result.warnings.length} 个文件已跳过`
          : `扫描完成，共 ${result.tracks.length} 首歌曲`,
      });
    } catch (error) {
      set({ libraryMessage: error instanceof Error ? error.message : '重新扫描失败' });
    } finally {
      set({ scanning: false, scanProgress: null });
    }
  },

  setScanProgress: (scanProgress) => {
    if (scanProgress.completed) {
      set({ scanProgress: null, scanning: false });
      return;
    }
    set({ scanProgress, scanning: true });
  },

  selectTrack: (trackId, play = true) => {
    const state = get();
    const track = state.tracks.find((item) => item.id === trackId);
    if (!track) return;
    const resumeTime = resumeTimeForTrack(track, state.playbackProgress[trackId]);
    set({
      currentTrackId: trackId,
      isPlaying: play,
      currentTime: resumeTime,
      duration: track.duration,
      playbackError: null,
      lyricsStatus: 'loading',
      lyricLines: [],
      lyricOffsetMs: 0,
      lyricsSource: null,
      lyricsRevision: null,
      simplifiedLyricsWriteBusy: false,
      lyricTimingWriteBusy: false,
      lyricTimingWriteError: null,
      lyricTimingWriteMessage: null,
      lyricsError: null,
      onlineLyricsTask: null,
      onlineLyricsBusy: false,
      localLyricsTask: state.localLyricsTasks[trackId] ?? null,
      localLyricsBusy: false,
      localLyricsProofreadBusy: false,
      localLyricsProofreadError: null,
      bilingualLyricsTask: state.bilingualLyricsTasks[trackId] ?? null,
      bilingualLyricsBusy: false,
    });
    void get().loadLyrics(trackId);
    void get().loadOnlineLyricsTask(trackId);
    void get().loadLocalLyricsTask(trackId);
    void get().loadBilingualLyricsTask(trackId);
  },

  togglePlayback: () => {
    const state = get();
    if (!state.currentTrackId && state.queueIds.length > 0) {
      const firstId = state.playbackMode === 'shuffle'
        ? (state.shuffleQueueIds[0] ?? state.queueIds[0])
        : state.queueIds[0];
      state.selectTrack(firstId, true);
      return;
    }
    if (state.currentTrackId) set({ isPlaying: !state.isPlaying, playbackError: null });
  },

  setPlaying: (isPlaying) => set({ isPlaying }),

  nextTrack: () => {
    const state = get();
    if (state.queueIds.length === 0) return;
    if (state.playbackMode === 'shuffle') {
      let order = reconcileShuffleQueue(state.queueIds, state.shuffleQueueIds);
      const index = state.currentTrackId ? order.indexOf(state.currentTrackId) : -1;
      let nextId: string;
      if (index < 0) {
        nextId = order[0];
      } else if (index < order.length - 1) {
        nextId = order[index + 1];
      } else {
        order = shuffleQueue(state.queueIds, state.currentTrackId);
        nextId = order[1] ?? order[0];
      }
      set({ shuffleQueueIds: order });
      state.selectTrack(nextId, true);
      return;
    }
    const index = state.currentTrackId ? state.queueIds.indexOf(state.currentTrackId) : -1;
    const nextId = state.queueIds[(index + 1 + state.queueIds.length) % state.queueIds.length];
    state.selectTrack(nextId, true);
  },

  previousTrack: () => {
    const state = get();
    if (state.queueIds.length === 0) return;
    if (state.playbackMode === 'shuffle') {
      const order = reconcileShuffleQueue(state.queueIds, state.shuffleQueueIds);
      const index = state.currentTrackId ? order.indexOf(state.currentTrackId) : 0;
      const previousId = order[(index - 1 + order.length) % order.length];
      set({ shuffleQueueIds: order });
      state.selectTrack(previousId, true);
      return;
    }
    const index = state.currentTrackId ? state.queueIds.indexOf(state.currentTrackId) : 0;
    const previousId = state.queueIds[(index - 1 + state.queueIds.length) % state.queueIds.length];
    state.selectTrack(previousId, true);
  },

  handleTrackEnded: () => {
    const state = get();
    if (!state.currentTrackId) return;
    if (state.playbackMode === 'repeat-one') {
      set({ currentTime: 0, isPlaying: true, playbackError: null });
      return;
    }
    if (state.playbackMode === 'shuffle') {
      state.nextTrack();
      return;
    }
    const index = state.queueIds.indexOf(state.currentTrackId);
    if (index >= 0 && index < state.queueIds.length - 1) {
      state.selectTrack(state.queueIds[index + 1], true);
      return;
    }
    set({ currentTime: 0, isPlaying: false });
  },

  setPlaybackMode: (playbackMode) => {
    if (!PLAYBACK_MODES.includes(playbackMode)) return;
    const state = get();
    set({
      playbackMode,
      ...(playbackMode === 'shuffle'
        ? { shuffleQueueIds: shuffleQueue(state.queueIds, state.currentTrackId) }
        : {}),
    });
  },

  cyclePlaybackMode: () => {
    const state = get();
    const index = PLAYBACK_MODES.indexOf(state.playbackMode);
    state.setPlaybackMode(PLAYBACK_MODES[(index + 1) % PLAYBACK_MODES.length]);
  },

  setPlaybackTime: (currentTime, duration) =>
    set((state) => ({
      currentTime,
      duration: Number.isFinite(duration) && duration !== undefined ? duration : state.duration,
    })),
  setDuration: (duration) => set({ duration: Number.isFinite(duration) ? duration : 0 }),
  setVolume: (volume) => set({ volume: Math.min(1, Math.max(0, volume)) }),
  setPlaybackError: (playbackError) => set({ playbackError }),

  loadLyrics: async (trackId) => {
    set({ lyricsStatus: 'loading', lyricsError: null });
    try {
      const document = await window.lyralume.lyrics.load(trackId);
      if (get().currentTrackId !== trackId) return;
      if (document.status === 'missing') {
        set({
          lyricsStatus: 'missing',
          lyricLines: [],
          lyricOffsetMs: 0,
          lyricsSource: null,
          lyricsRevision: null,
        });
        return;
      }
      if (document.status === 'error' || !document.raw) {
        set({
          lyricsStatus: 'error',
          lyricLines: [],
          lyricsSource: null,
          lyricsRevision: null,
          lyricsError: document.message ?? '歌词无法读取',
        });
        return;
      }
      const parsed = parseLrc(document.raw);
      const lyricLines = mergePreciseLyricTiming(parsed.lines, document.preciseTiming);
      if (parsed.lines.length === 0) {
        set({
          lyricsStatus: 'error',
          lyricLines: [],
          lyricOffsetMs: 0,
          lyricsSource: null,
          lyricsRevision: null,
          lyricsError: '歌词中没有有效时间戳',
        });
        return;
      }
      set({
        lyricsStatus: 'loaded',
        lyricLines,
        lyricOffsetMs: parsed.sourceOffsetMs,
        lyricsSource: document.source ?? null,
        lyricsRevision: document.revision ?? null,
        lyricsError: null,
      });
    } catch (error) {
      if (get().currentTrackId !== trackId) return;
      set({
        lyricsStatus: 'error',
        lyricLines: [],
        lyricsSource: null,
        lyricsRevision: null,
        lyricsError: error instanceof Error ? error.message : '歌词载入失败',
      });
    }
  },

  loadOnlineLyricsTask: async (trackId) => {
    try {
      const task = await window.lyralume.lyrics.getOnlineTask(trackId);
      if (get().currentTrackId === trackId) set({ onlineLyricsTask: task });
    } catch {
      if (get().currentTrackId === trackId) set({ onlineLyricsTask: null });
    }
  },

  searchOnlineLyrics: async () => {
    const trackId = get().currentTrackId;
    if (!trackId || get().onlineLyricsBusy) return;
    set((state) => ({
      onlineLyricsBusy: true,
      onlineLyricsTask: {
        ...(state.onlineLyricsTask ?? emptyOnlineTask(trackId)),
        status: 'querying',
        source: 'lrclib',
        candidates: [],
        selectedCandidateId: undefined,
        lrcFileName: undefined,
        lrcSaveStatus: 'not_started',
        tagWriteStatus: 'not_started',
        error: undefined,
        updatedAt: Date.now(),
      },
    }));
    try {
      const task = await window.lyralume.lyrics.searchOnline(trackId);
      if (get().currentTrackId === trackId) set({ onlineLyricsTask: task });
    } catch (error) {
      if (get().currentTrackId === trackId) {
        set({
          onlineLyricsTask: failedOnlineTask(
            trackId,
            get().onlineLyricsTask,
            error instanceof Error ? error.message : '在线歌词查询失败',
          ),
        });
      }
    } finally {
      if (get().currentTrackId === trackId) set({ onlineLyricsBusy: false });
    }
  },

  saveOnlineLyrics: async (candidateId, overwriteExisting = false) => {
    const trackId = get().currentTrackId;
    if (!trackId || get().onlineLyricsBusy) return;
    set((state) => ({
      onlineLyricsBusy: true,
      onlineLyricsTask: state.onlineLyricsTask ? {
        ...state.onlineLyricsTask,
        status: 'saving',
        selectedCandidateId: candidateId,
        lrcSaveStatus: 'saving',
        error: undefined,
        updatedAt: Date.now(),
      } : null,
    }));
    try {
      const task = await window.lyralume.lyrics.saveOnline(trackId, candidateId, overwriteExisting);
      if (get().currentTrackId !== trackId) return;
      set({ onlineLyricsTask: task });
      if (task.lrcSaveStatus === 'saved') await get().loadLyrics(trackId);
    } catch (error) {
      if (get().currentTrackId === trackId) {
        set({
          onlineLyricsTask: failedOnlineTask(
            trackId,
            get().onlineLyricsTask,
            error instanceof Error ? error.message : '在线歌词保存失败',
          ),
        });
      }
    } finally {
      if (get().currentTrackId === trackId) set({ onlineLyricsBusy: false });
    }
  },

  writeOnlineLyricsTag: async (candidateId) => {
    const trackId = get().currentTrackId;
    if (!trackId || get().onlineLyricsBusy) return null;
    set((state) => ({
      onlineLyricsBusy: true,
      onlineLyricsTask: state.onlineLyricsTask ? {
        ...state.onlineLyricsTask,
        status: 'writing_tag',
        selectedCandidateId: candidateId ?? state.onlineLyricsTask.selectedCandidateId,
        tagWriteStatus: 'writing',
        error: undefined,
        updatedAt: Date.now(),
      } : null,
    }));
    try {
      const task = await window.lyralume.lyrics.writeTag(trackId, candidateId);
      if (get().currentTrackId === trackId) {
        set({ onlineLyricsTask: task });
        if (task.tagWriteStatus === 'verified') await get().loadLyrics(trackId);
      }
      return task;
    } catch (error) {
      if (get().currentTrackId === trackId) {
        const task = failedOnlineTask(
          trackId,
          get().onlineLyricsTask,
          error instanceof Error ? error.message : '同步歌词标签写入失败',
        );
        set({ onlineLyricsTask: task });
        return task;
      }
      return null;
    } finally {
      if (get().currentTrackId === trackId) set({ onlineLyricsBusy: false });
    }
  },

  loadLocalLyricsTask: async (trackId) => {
    try {
      const task = await window.lyralume.lyrics.getLocalTask(trackId);
      set((state) => ({
        localLyricsTasks: { ...state.localLyricsTasks, [trackId]: task },
        ...(state.currentTrackId === trackId ? { localLyricsTask: task } : {}),
      }));
    } catch {
      if (get().currentTrackId === trackId) set({ localLyricsTask: null });
    }
  },

  loadLocalLyricsModelSettings: async () => {
    set({ localLyricsModelSettingsBusy: true, localLyricsModelSettingsError: null });
    try {
      const settings = await window.lyralume.lyrics.getLocalModelSettings();
      set({ localLyricsModelSettings: settings });
    } catch (error) {
      set({
        localLyricsModelSettingsError: error instanceof Error
          ? error.message
          : 'UVR 模型设置加载失败',
      });
    } finally {
      set({ localLyricsModelSettingsBusy: false });
    }
  },

  chooseLocalUvrModel: async () => {
    if (get().localLyricsModelSettingsBusy) return;
    set({ localLyricsModelSettingsBusy: true, localLyricsModelSettingsError: null });
    try {
      const settings = await window.lyralume.lyrics.chooseLocalUvrModel();
      if (settings) set({ localLyricsModelSettings: settings });
    } catch (error) {
      set({
        localLyricsModelSettingsError: error instanceof Error
          ? error.message
          : '自定义 UVR 模型选择失败',
      });
    } finally {
      set({ localLyricsModelSettingsBusy: false });
    }
  },

  resetLocalUvrModel: async () => {
    if (get().localLyricsModelSettingsBusy) return;
    set({ localLyricsModelSettingsBusy: true, localLyricsModelSettingsError: null });
    try {
      const settings = await window.lyralume.lyrics.resetLocalUvrModel();
      set({ localLyricsModelSettings: settings });
    } catch (error) {
      set({
        localLyricsModelSettingsError: error instanceof Error
          ? error.message
          : '恢复默认 UVR 模型失败',
      });
    } finally {
      set({ localLyricsModelSettingsBusy: false });
    }
  },

  applyLocalLyricsTask: (task) => {
    set((state) => ({
      localLyricsTasks: { ...state.localLyricsTasks, [task.trackId]: task },
      ...(state.currentTrackId === task.trackId ? { localLyricsTask: task } : {}),
    }));
  },

  applyLocalLyricsProofreadProgress: (progress) => {
    set((state) => {
      const current = state.localLyricsProofreadProgress[progress.trackId] ?? [];
      const previous = current[current.length - 1];
      if (
        previous?.stage === progress.stage
        && previous.message === progress.message
        && previous.detail === progress.detail
      ) return state;
      return {
        localLyricsProofreadProgress: {
          ...state.localLyricsProofreadProgress,
          [progress.trackId]: [...current, progress].slice(-40),
        },
      };
    });
  },

  startLocalLyrics: async (options = {}) => {
    const trackId = get().currentTrackId;
    if (!trackId || get().localLyricsBusy) return;
    set({ localLyricsBusy: true });
    try {
      const task = await window.lyralume.lyrics.startLocal(trackId, options);
      set((state) => ({
        localLyricsTasks: { ...state.localLyricsTasks, [trackId]: task },
        ...(state.currentTrackId === trackId ? { localLyricsTask: task } : {}),
      }));
    } catch (error) {
      if (get().currentTrackId === trackId) {
        set({
          localLyricsTask: failedLocalTask(
            trackId,
            get().localLyricsTask,
            error instanceof Error ? error.message : '本地歌词任务启动失败',
          ),
        });
      }
    } finally {
      if (get().currentTrackId === trackId) set({ localLyricsBusy: false });
    }
  },

  cancelLocalLyrics: async (requestedTrackId) => {
    const trackId = requestedTrackId ?? get().currentTrackId;
    if (!trackId) return;
    const affectsCurrentTrack = get().currentTrackId === trackId;
    if (affectsCurrentTrack && get().localLyricsBusy) return;
    if (affectsCurrentTrack) set({ localLyricsBusy: true });
    try {
      const task = await window.lyralume.lyrics.cancelLocal(trackId);
      get().applyLocalLyricsTask(task);
    } finally {
      if (get().currentTrackId === trackId) set({ localLyricsBusy: false });
    }
  },

  proofreadLocalLyrics: async (update) => {
    const trackId = get().currentTrackId;
    if (!trackId || get().localLyricsBusy || get().localLyricsProofreadBusy) return null;
    set((state) => ({
      localLyricsProofreadBusy: true,
      localLyricsProofreadError: null,
      localLyricsProofreadProgress: {
        ...state.localLyricsProofreadProgress,
        [trackId]: [],
      },
    }));
    try {
      const result = await window.lyralume.lyrics.proofreadLocal(trackId, update);
      return get().currentTrackId === trackId ? result : null;
    } catch (error) {
      if (get().currentTrackId === trackId) {
        set({
          localLyricsProofreadError: error instanceof Error
            ? error.message
            : 'Codex 歌词校对失败',
        });
      }
      return null;
    } finally {
      if (get().currentTrackId === trackId) set({ localLyricsProofreadBusy: false });
    }
  },

  saveLocalLyricsDraft: async (update) => {
    const trackId = get().currentTrackId;
    if (!trackId || get().localLyricsBusy) return null;
    set({ localLyricsBusy: true });
    try {
      const task = await window.lyralume.lyrics.saveLocalDraft(trackId, update);
      if (get().currentTrackId === trackId) set({ localLyricsTask: task });
      return task;
    } catch (error) {
      if (get().currentTrackId !== trackId) return null;
      const task = failedLocalTask(
        trackId,
        get().localLyricsTask,
        error instanceof Error ? error.message : '歌词草稿保存失败',
      );
      set({ localLyricsTask: task });
      return task;
    } finally {
      if (get().currentTrackId === trackId) set({ localLyricsBusy: false });
    }
  },

  confirmLocalLyricsLrc: async (update, overwriteExisting = false) => {
    const trackId = get().currentTrackId;
    if (!trackId || get().localLyricsBusy) return null;
    set({ localLyricsBusy: true });
    try {
      const task = await window.lyralume.lyrics.confirmLocalLrc(
        trackId,
        update,
        overwriteExisting,
      );
      if (get().currentTrackId === trackId) {
        set({ localLyricsTask: task });
        if (task.lrcSaveStatus === 'saved') await get().loadLyrics(trackId);
      }
      return task;
    } catch (error) {
      if (get().currentTrackId !== trackId) return null;
      const task = failedLocalTask(
        trackId,
        get().localLyricsTask,
        error instanceof Error ? error.message : '正式 LRC 保存失败',
      );
      set({ localLyricsTask: task });
      return task;
    } finally {
      if (get().currentTrackId === trackId) set({ localLyricsBusy: false });
    }
  },

  writeLocalLyricsTag: async (update) => {
    const trackId = get().currentTrackId;
    if (!trackId || get().localLyricsBusy) return null;
    set({ localLyricsBusy: true });
    try {
      const task = await window.lyralume.lyrics.writeLocalTag(trackId, update);
      if (get().currentTrackId === trackId) {
        set({ localLyricsTask: task });
        if (task.tagWriteStatus === 'verified') await get().loadLyrics(trackId);
      }
      return task;
    } catch (error) {
      if (get().currentTrackId !== trackId) return null;
      const task = failedLocalTask(
        trackId,
        get().localLyricsTask,
        error instanceof Error ? error.message : '同步歌词标签写入失败',
      );
      set({ localLyricsTask: task });
      return task;
    } finally {
      if (get().currentTrackId === trackId) set({ localLyricsBusy: false });
    }
  },

  loadBilingualLyricsTask: async (trackId) => {
    try {
      const task = await window.lyralume.lyrics.getBilingualTask(trackId);
      set((state) => ({
        bilingualLyricsTasks: { ...state.bilingualLyricsTasks, [trackId]: task },
        ...(state.currentTrackId === trackId ? { bilingualLyricsTask: task } : {}),
      }));
    } catch (error) {
      if (get().currentTrackId === trackId) {
        set({
          bilingualLyricsTask: failedBilingualTask(
            trackId,
            get().bilingualLyricsTask,
            error instanceof Error ? error.message : '双语歌词任务读取失败',
          ),
        });
      }
    }
  },

  applyBilingualLyricsTask: (task) => {
    set((state) => ({
      bilingualLyricsTasks: { ...state.bilingualLyricsTasks, [task.trackId]: task },
      ...(state.currentTrackId === task.trackId ? { bilingualLyricsTask: task } : {}),
    }));
  },

  startBilingualLyrics: async (options = {}) => {
    const trackId = get().currentTrackId;
    if (!trackId || get().bilingualLyricsBusy) return;
    set({ bilingualLyricsBusy: true });
    try {
      const task = await window.lyralume.lyrics.startBilingual(trackId, options);
      get().applyBilingualLyricsTask(task);
    } catch (error) {
      const task = failedBilingualTask(
        trackId,
        get().bilingualLyricsTask,
        error instanceof Error ? error.message : 'Codex 双语译配启动失败',
      );
      get().applyBilingualLyricsTask(task);
    } finally {
      set({ bilingualLyricsBusy: false });
    }
  },

  cancelBilingualLyrics: async (requestedTrackId) => {
    const trackId = requestedTrackId ?? get().currentTrackId;
    if (!trackId) return;
    try {
      const task = await window.lyralume.lyrics.cancelBilingual(trackId);
      get().applyBilingualLyricsTask(task);
    } catch (error) {
      const task = failedBilingualTask(
        trackId,
        get().bilingualLyricsTasks[trackId] ?? null,
        error instanceof Error ? error.message : 'Codex 双语译配取消失败',
      );
      get().applyBilingualLyricsTask(task);
    }
  },

  writeBilingualLyricsTag: async () => {
    const trackId = get().currentTrackId;
    if (!trackId || get().bilingualLyricsBusy) return null;
    set({ bilingualLyricsBusy: true });
    try {
      const task = await window.lyralume.lyrics.writeBilingualTag(trackId);
      get().applyBilingualLyricsTask(task);
      if (task.tagWriteStatus === 'verified' && get().currentTrackId === trackId) {
        await get().loadLyrics(trackId);
      }
      return task;
    } catch (error) {
      const task = failedBilingualTask(
        trackId,
        get().bilingualLyricsTask,
        error instanceof Error ? error.message : '双语同步歌词标签写入失败',
      );
      get().applyBilingualLyricsTask(task);
      return task;
    } finally {
      if (get().currentTrackId === trackId) set({ bilingualLyricsBusy: false });
    }
  },

  writeSimplifiedLyrics: async () => {
    const state = get();
    const trackId = state.currentTrackId;
    const sourceRevision = state.lyricsRevision;
    const track = state.tracks.find((item) => item.id === trackId);
    if (
      !trackId
      || !track
      || !sourceRevision
      || state.lyricsStatus !== 'loaded'
      || state.simplifiedLyricsWriteBusy
    ) return false;
    const offsetMs = state.lyricOffsetMs;
    set({
      simplifiedLyricsWriteBusy: true,
      libraryMessage: `正在将《${track.title}》的歌词转为简体并写入原 MP3…`,
    });
    try {
      const result = await window.lyralume.lyrics.writeSimplified(
        trackId,
        offsetMs,
        sourceRevision,
      );
      if (get().currentTrackId === trackId) await get().loadLyrics(trackId);
      set({
        libraryMessage: result.changedLineCount > 0
          ? `已转换 ${result.changedLineCount} 行，并将共 ${result.lineCount} 行写入《${track.title}》原 MP3 并通过回读验证`
          : `歌词原本已是简体；已将共 ${result.lineCount} 行写入《${track.title}》原 MP3 并通过回读验证`,
      });
      return true;
    } catch (error) {
      set({
        libraryMessage: error instanceof Error
          ? error.message
          : '简体歌词写入原 MP3 失败',
      });
      return false;
    } finally {
      set({ simplifiedLyricsWriteBusy: false });
    }
  },

  writeAdjustedLyricTiming: async () => {
    const state = get();
    const trackId = state.currentTrackId;
    const sourceRevision = state.lyricsRevision;
    if (
      !trackId
      || !sourceRevision
      || state.lyricsStatus !== 'loaded'
      || state.lyricTimingWriteBusy
    ) return false;
    const offsetMs = state.lyricOffsetMs;
    set({
      lyricTimingWriteBusy: true,
      lyricTimingWriteError: null,
      lyricTimingWriteMessage: null,
    });
    try {
      const result = await window.lyralume.lyrics.writeAdjustedTiming(
        trackId,
        offsetMs,
        sourceRevision,
      );
      if (get().currentTrackId !== trackId) return true;
      await get().loadLyrics(trackId);
      if (get().currentTrackId === trackId) {
        const signed = result.appliedOffsetMs > 0 ? '+' : '';
        set({
          lyricTimingWriteMessage: `已将 ${signed}${(result.appliedOffsetMs / 1000).toFixed(1)}s 应用到 ${result.lineCount} 行并写入原音频`,
        });
      }
      return true;
    } catch (error) {
      if (get().currentTrackId === trackId) {
        set({
          lyricTimingWriteError: error instanceof Error
            ? error.message
            : '校正后的同步歌词写入失败',
        });
      }
      return false;
    } finally {
      if (get().currentTrackId === trackId) set({ lyricTimingWriteBusy: false });
    }
  },

  adjustLyricOffset: (deltaMs) => set((state) => ({
    lyricOffsetMs: Math.max(-300_000, Math.min(300_000, state.lyricOffsetMs + deltaMs)),
    lyricTimingWriteError: null,
    lyricTimingWriteMessage: null,
  })),
  resetLyricOffset: () => set({
    lyricOffsetMs: 0,
    lyricTimingWriteError: null,
    lyricTimingWriteMessage: null,
  }),
  toggleVisuals: () => set((state) => ({ visualsEnabled: !state.visualsEnabled })),
  setVisualQuality: (quality) => set((state) => {
    persistVisualSettings({
      quality,
      intensity: state.visualIntensity,
      reducedMotion: state.visualReducedMotion,
    });
    return { visualQuality: quality };
  }),
  setVisualIntensity: (intensity) => set((state) => {
    const normalized = Math.min(1.35, Math.max(0.35, intensity));
    persistVisualSettings({
      quality: state.visualQuality,
      intensity: normalized,
      reducedMotion: state.visualReducedMotion,
    });
    return { visualIntensity: normalized };
  }),
  setVisualReducedMotion: (reducedMotion) => set((state) => {
    persistVisualSettings({
      quality: state.visualQuality,
      intensity: state.visualIntensity,
      reducedMotion,
    });
    return { visualReducedMotion: reducedMotion };
  }),
}));

export function currentTrackFromState(state: Pick<AppState, 'tracks' | 'currentTrackId'>): Track | null {
  return state.tracks.find((track) => track.id === state.currentTrackId) ?? null;
}
