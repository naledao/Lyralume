import { create } from 'zustand';
import type {
  LibraryRoot,
  LibrarySnapshot,
  LyricsStatus,
  ScanProgress,
  Track,
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
  visualsEnabled: boolean;
  initialize(): Promise<void>;
  applySnapshot(snapshot: LibrarySnapshot): void;
  chooseDirectory(): Promise<void>;
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

  setScanProgress: (scanProgress) => set({ scanProgress, scanning: true }),

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
    });
    void get().loadLyrics(trackId);
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

  adjustLyricOffset: (deltaMs) => set((state) => ({ lyricOffsetMs: state.lyricOffsetMs + deltaMs })),
  resetLyricOffset: () => set({ lyricOffsetMs: 0 }),
  toggleVisuals: () => set((state) => ({ visualsEnabled: !state.visualsEnabled })),
}));

export function currentTrackFromState(state: Pick<AppState, 'tracks' | 'currentTrackId'>): Track | null {
  return state.tracks.find((track) => track.id === state.currentTrackId) ?? null;
}
