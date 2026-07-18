import { create } from 'zustand';
import type {
  LibraryRoot,
  LibrarySnapshot,
  LyricsStatus,
  OnlineLyricsTask,
  ScanProgress,
  Track,
  TrackMetadataUpdate,
} from '../../shared/contracts';
import { parseLrc, type LyricLine } from '../../shared/lrc';

interface AppState {
  tracks: Track[];
  roots: LibraryRoot[];
  libraryLoading: boolean;
  scanning: boolean;
  scanProgress: ScanProgress | null;
  libraryMessage: string | null;
  currentTrackId: string | null;
  queueIds: string[];
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  volume: number;
  playbackError: string | null;
  lyricsStatus: LyricsStatus;
  lyricLines: LyricLine[];
  lyricOffsetMs: number;
  lyricsError: string | null;
  onlineLyricsTask: OnlineLyricsTask | null;
  onlineLyricsBusy: boolean;
  visualsEnabled: boolean;
  initialize(): Promise<void>;
  applySnapshot(snapshot: LibrarySnapshot): void;
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
  setPlaybackTime(time: number, duration?: number): void;
  setDuration(duration: number): void;
  setVolume(volume: number): void;
  setPlaybackError(message: string | null): void;
  loadLyrics(trackId: string): Promise<void>;
  loadOnlineLyricsTask(trackId: string): Promise<void>;
  searchOnlineLyrics(): Promise<void>;
  saveOnlineLyrics(candidateId: number, overwriteExisting?: boolean): Promise<void>;
  writeOnlineLyricsTag(candidateId?: number): Promise<OnlineLyricsTask | null>;
  adjustLyricOffset(deltaMs: number): void;
  resetLyricOffset(): void;
  toggleVisuals(): void;
}

function normalizedQueue(snapshot: LibrarySnapshot, currentQueue: string[]): string[] {
  const validIds = new Set(snapshot.tracks.map((track) => track.id));
  const retained = currentQueue.filter((id) => validIds.has(id));
  const retainedSet = new Set(retained);
  return [...retained, ...snapshot.tracks.map((track) => track.id).filter((id) => !retainedSet.has(id))];
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

export const useAppStore = create<AppState>((set, get) => ({
  tracks: [],
  roots: [],
  libraryLoading: true,
  scanning: false,
  scanProgress: null,
  libraryMessage: null,
  currentTrackId: null,
  queueIds: [],
  isPlaying: false,
  currentTime: 0,
  duration: 0,
  volume: 0.78,
  playbackError: null,
  lyricsStatus: 'idle',
  lyricLines: [],
  lyricOffsetMs: 0,
  lyricsError: null,
  onlineLyricsTask: null,
  onlineLyricsBusy: false,
  visualsEnabled: true,

  initialize: async () => {
    set({ libraryLoading: true, libraryMessage: null });
    try {
      const snapshot = await window.lyralume.library.getSnapshot();
      get().applySnapshot(snapshot);
    } catch (error) {
      set({
        libraryMessage: error instanceof Error ? error.message : '音乐库载入失败',
      });
    } finally {
      set({ libraryLoading: false });
    }
  },

  applySnapshot: (snapshot) => {
    const state = get();
    const queueIds = normalizedQueue(snapshot, state.queueIds);
    const currentStillExists = snapshot.tracks.some((track) => track.id === state.currentTrackId);
    set({
      tracks: snapshot.tracks,
      roots: snapshot.roots,
      queueIds,
      currentTrackId: currentStillExists ? state.currentTrackId : null,
      isPlaying: currentStillExists ? state.isPlaying : false,
      currentTime: currentStillExists ? state.currentTime : 0,
      duration: currentStillExists ? state.duration : 0,
      playbackError: currentStillExists ? state.playbackError : null,
      lyricsStatus: currentStillExists ? state.lyricsStatus : 'idle',
      lyricLines: currentStillExists ? state.lyricLines : [],
      lyricOffsetMs: currentStillExists ? state.lyricOffsetMs : 0,
      lyricsError: currentStillExists ? state.lyricsError : null,
      onlineLyricsTask: currentStillExists ? state.onlineLyricsTask : null,
      onlineLyricsBusy: currentStillExists ? state.onlineLyricsBusy : false,
    });
  },

  chooseDirectory: async () => {
    set({ scanning: true, libraryMessage: null });
    try {
      const result = await window.lyralume.library.chooseDirectory();
      if (!result) return;
      get().applySnapshot(result);
      const warningText = result.warnings.length
        ? `已导入 ${result.importedTracks} 首，${result.warnings.length} 个文件无法读取`
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
      set({
        libraryMessage: result.warnings.length
          ? `已导入 ${result.importedTracks} 首，${result.warnings.length} 个项目无法读取`
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
    set({ libraryMessage: `正在将《${track.title}》的歌曲信息写入原文件…` });
    try {
      const snapshot = await window.lyralume.library.updateMetadata(trackId, metadata);
      get().applySnapshot(snapshot);
      set({
        libraryMessage: `已将《${metadata.title?.trim() || track.title}》的歌曲信息写入原文件并验证`,
      });
      return true;
    } catch (error) {
      set({ libraryMessage: error instanceof Error ? error.message : '歌曲信息写入原文件失败' });
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
    if (!get().tracks.some((track) => track.id === trackId)) return;
    set({
      currentTrackId: trackId,
      isPlaying: play,
      currentTime: 0,
      duration: 0,
      playbackError: null,
      lyricsStatus: 'loading',
      lyricLines: [],
      lyricOffsetMs: 0,
      lyricsError: null,
      onlineLyricsTask: null,
      onlineLyricsBusy: false,
    });
    void get().loadLyrics(trackId);
    void get().loadOnlineLyricsTask(trackId);
  },

  togglePlayback: () => {
    const state = get();
    if (!state.currentTrackId && state.queueIds.length > 0) {
      state.selectTrack(state.queueIds[0], true);
      return;
    }
    if (state.currentTrackId) set({ isPlaying: !state.isPlaying, playbackError: null });
  },

  setPlaying: (isPlaying) => set({ isPlaying }),

  nextTrack: () => {
    const state = get();
    if (state.queueIds.length === 0) return;
    const index = state.currentTrackId ? state.queueIds.indexOf(state.currentTrackId) : -1;
    const nextId = state.queueIds[(index + 1 + state.queueIds.length) % state.queueIds.length];
    state.selectTrack(nextId, true);
  },

  previousTrack: () => {
    const state = get();
    if (state.queueIds.length === 0) return;
    const index = state.currentTrackId ? state.queueIds.indexOf(state.currentTrackId) : 0;
    const previousId = state.queueIds[(index - 1 + state.queueIds.length) % state.queueIds.length];
    state.selectTrack(previousId, true);
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
        set({ lyricsStatus: 'missing', lyricLines: [], lyricOffsetMs: 0 });
        return;
      }
      if (document.status === 'error' || !document.raw) {
        set({
          lyricsStatus: 'error',
          lyricLines: [],
          lyricsError: document.message ?? '歌词无法读取',
        });
        return;
      }
      const parsed = parseLrc(document.raw);
      if (parsed.lines.length === 0) {
        set({ lyricsStatus: 'error', lyricLines: [], lyricsError: '歌词中没有有效时间戳' });
        return;
      }
      set({
        lyricsStatus: 'loaded',
        lyricLines: parsed.lines,
        lyricOffsetMs: parsed.sourceOffsetMs,
        lyricsError: null,
      });
    } catch (error) {
      if (get().currentTrackId !== trackId) return;
      set({
        lyricsStatus: 'error',
        lyricLines: [],
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

  adjustLyricOffset: (deltaMs) => set((state) => ({ lyricOffsetMs: state.lyricOffsetMs + deltaMs })),
  resetLyricOffset: () => set({ lyricOffsetMs: 0 }),
  toggleVisuals: () => set((state) => ({ visualsEnabled: !state.visualsEnabled })),
}));

export function currentTrackFromState(state: Pick<AppState, 'tracks' | 'currentTrackId'>): Track | null {
  return state.tracks.find((track) => track.id === state.currentTrackId) ?? null;
}
