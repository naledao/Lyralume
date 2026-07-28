import { contextBridge, ipcRenderer, webUtils } from 'electron';
import type {
  BilingualLyricsTask,
  LibrarySnapshot,
  LocalLyricsProofreadProgress,
  LocalLyricsTask,
  LyralumeApi,
  LyricsTaskSnapshot,
  LyricsTaskTarget,
  MusicDownloadTask,
  PlaybackStateSnapshot,
  RemoteMusicSnapshot,
  ScanProgress,
  TrackVisualAnalysis,
  VisualAnalysisProgress,
} from '../shared/contracts.js';

// Keep the sandboxed preload self-contained: sandboxed preloads may only require
// Electron and a small set of Node built-ins.
const IPC_CHANNELS = {
  librarySnapshot: 'library:snapshot',
  libraryChooseDirectory: 'library:choose-directory',
  libraryImportDropped: 'library:import-dropped',
  libraryUpdateMetadata: 'library:update-metadata',
  libraryChooseArtwork: 'library:choose-artwork',
  libraryRemoveTrack: 'library:remove-track',
  libraryRescan: 'library:rescan',
  libraryChanged: 'library:changed',
  libraryScanProgress: 'library:scan-progress',
  playbackState: 'playback:state',
  playbackCheckpoint: 'playback:checkpoint',
  playbackFlushRequested: 'playback:flush-requested',
  playbackFlushComplete: 'playback:flush-complete',
  visualAnalysisGet: 'visual-analysis:get',
  visualAnalysisRun: 'visual-analysis:run',
  visualAnalysisChanged: 'visual-analysis:changed',
  visualAnalysisProgress: 'visual-analysis:progress',
  lyricsLoad: 'lyrics:load',
  lyricsTasks: 'lyrics:tasks',
  lyricsTaskStatusOverride: 'lyrics:task-status-override',
  lyricsWriteAdjustedTiming: 'lyrics:write-adjusted-timing',
  lyricsWriteSimplified: 'lyrics:write-simplified',
  lyricsOnlineTask: 'lyrics:online-task',
  lyricsOnlineSearch: 'lyrics:online-search',
  lyricsOnlineSave: 'lyrics:online-save',
  lyricsWriteTag: 'lyrics:write-tag',
  lyricsLocalTask: 'lyrics:local-task',
  lyricsLocalModelSettings: 'lyrics:local-model-settings',
  lyricsLocalChooseUvrModel: 'lyrics:local-choose-uvr-model',
  lyricsLocalResetUvrModel: 'lyrics:local-reset-uvr-model',
  lyricsLocalStart: 'lyrics:local-start',
  lyricsLocalCancel: 'lyrics:local-cancel',
  lyricsLocalProofread: 'lyrics:local-proofread',
  lyricsLocalSaveDraft: 'lyrics:local-save-draft',
  lyricsLocalConfirmLrc: 'lyrics:local-confirm-lrc',
  lyricsLocalWriteTag: 'lyrics:local-write-tag',
  lyricsLocalChanged: 'lyrics:local-changed',
  lyricsLocalProofreadProgress: 'lyrics:local-proofread-progress',
  lyricsBilingualTask: 'lyrics:bilingual-task',
  lyricsBilingualStart: 'lyrics:bilingual-start',
  lyricsBilingualCancel: 'lyrics:bilingual-cancel',
  lyricsBilingualWriteTag: 'lyrics:bilingual-write-tag',
  lyricsBilingualChanged: 'lyrics:bilingual-changed',
  settingsGet: 'settings:get',
  settingsChooseDownloadDirectory: 'settings:choose-download-directory',
  settingsUpdateProxy: 'settings:update-proxy',
  settingsUpdateMinio: 'settings:update-minio',
  settingsClearMinio: 'settings:clear-minio',
  settingsChooseCookieFile: 'settings:choose-cookie-file',
  settingsClearCookie: 'settings:clear-cookie',
  remoteSnapshot: 'remote:snapshot',
  remoteRefresh: 'remote:refresh',
  remoteTestConnection: 'remote:test-connection',
  remoteSyncAll: 'remote:sync-all',
  remoteSyncTrack: 'remote:sync-track',
  remoteChanged: 'remote:changed',
  musicRuntime: 'music:runtime',
  musicSearch: 'music:search',
  musicTasks: 'music:tasks',
  musicDownloadStart: 'music:download-start',
  musicDownloadCancel: 'music:download-cancel',
  musicOpenDownloadDirectory: 'music:open-download-directory',
  musicDownloadChanged: 'music:download-changed',
  appVersion: 'app:version',
  appSetFullscreen: 'app:set-fullscreen',
  appOpenTask: 'app:open-task',
  appFullscreenChanged: 'app:fullscreen-changed',
} as const;

const api: LyralumeApi = {
  library: {
    getSnapshot: () => ipcRenderer.invoke(IPC_CHANNELS.librarySnapshot),
    chooseDirectory: () => ipcRenderer.invoke(IPC_CHANNELS.libraryChooseDirectory),
    importDropped: (files) => ipcRenderer.invoke(
      IPC_CHANNELS.libraryImportDropped,
      files.map((file) => webUtils.getPathForFile(file)).filter(Boolean),
    ),
    updateMetadata: (trackId, metadata) => ipcRenderer.invoke(
      IPC_CHANNELS.libraryUpdateMetadata,
      trackId,
      metadata,
    ),
    chooseArtwork: (trackId) => ipcRenderer.invoke(IPC_CHANNELS.libraryChooseArtwork, trackId),
    removeTrack: (trackId) => ipcRenderer.invoke(IPC_CHANNELS.libraryRemoveTrack, trackId),
    rescan: () => ipcRenderer.invoke(IPC_CHANNELS.libraryRescan),
    onChanged: (callback) => {
      const listener = (_event: Electron.IpcRendererEvent, snapshot: LibrarySnapshot): void => {
        callback(snapshot);
      };
      ipcRenderer.on(IPC_CHANNELS.libraryChanged, listener);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.libraryChanged, listener);
    },
    onScanProgress: (callback) => {
      const listener = (_event: Electron.IpcRendererEvent, progress: ScanProgress): void => {
        callback(progress);
      };
      ipcRenderer.on(IPC_CHANNELS.libraryScanProgress, listener);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.libraryScanProgress, listener);
    },
  },
  playback: {
    getState: () => ipcRenderer.invoke(IPC_CHANNELS.playbackState) as Promise<PlaybackStateSnapshot>,
    saveCheckpoint: (checkpoint) => ipcRenderer.invoke(
      IPC_CHANNELS.playbackCheckpoint,
      checkpoint,
    ),
  },
  visuals: {
    getAnalysis: (trackId) => ipcRenderer.invoke(
      IPC_CHANNELS.visualAnalysisGet,
      trackId,
    ),
    reanalyze: (trackId) => ipcRenderer.invoke(
      IPC_CHANNELS.visualAnalysisRun,
      trackId,
    ),
    onAnalysisChanged: (callback) => {
      const listener = (_event: Electron.IpcRendererEvent, analysis: TrackVisualAnalysis): void => {
        callback(analysis);
      };
      ipcRenderer.on(IPC_CHANNELS.visualAnalysisChanged, listener);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.visualAnalysisChanged, listener);
    },
    onAnalysisProgress: (callback) => {
      const listener = (_event: Electron.IpcRendererEvent, progress: VisualAnalysisProgress): void => {
        callback(progress);
      };
      ipcRenderer.on(IPC_CHANNELS.visualAnalysisProgress, listener);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.visualAnalysisProgress, listener);
    },
  },
  lyrics: {
    load: (trackId) => ipcRenderer.invoke(IPC_CHANNELS.lyricsLoad, trackId),
    getTasks: () => ipcRenderer.invoke(IPC_CHANNELS.lyricsTasks) as Promise<LyricsTaskSnapshot>,
    setTaskStatusOverride: (target, statusOverride) => ipcRenderer.invoke(
      IPC_CHANNELS.lyricsTaskStatusOverride,
      target,
      statusOverride,
    ),
    writeAdjustedTiming: (trackId, offsetMs, sourceRevision) => ipcRenderer.invoke(
      IPC_CHANNELS.lyricsWriteAdjustedTiming,
      trackId,
      offsetMs,
      sourceRevision,
    ),
    writeSimplified: (trackId, offsetMs, sourceRevision) => ipcRenderer.invoke(
      IPC_CHANNELS.lyricsWriteSimplified,
      trackId,
      offsetMs,
      sourceRevision,
    ),
    getOnlineTask: (trackId) => ipcRenderer.invoke(IPC_CHANNELS.lyricsOnlineTask, trackId),
    searchOnline: (trackId) => ipcRenderer.invoke(IPC_CHANNELS.lyricsOnlineSearch, trackId),
    saveOnline: (trackId, candidateId, overwriteExisting) => ipcRenderer.invoke(
      IPC_CHANNELS.lyricsOnlineSave,
      trackId,
      candidateId,
      overwriteExisting,
    ),
    writeTag: (trackId, candidateId) => ipcRenderer.invoke(
      IPC_CHANNELS.lyricsWriteTag,
      trackId,
      candidateId,
    ),
    getLocalTask: (trackId) => ipcRenderer.invoke(IPC_CHANNELS.lyricsLocalTask, trackId),
    getLocalModelSettings: () => ipcRenderer.invoke(IPC_CHANNELS.lyricsLocalModelSettings),
    chooseLocalUvrModel: () => ipcRenderer.invoke(IPC_CHANNELS.lyricsLocalChooseUvrModel),
    resetLocalUvrModel: () => ipcRenderer.invoke(IPC_CHANNELS.lyricsLocalResetUvrModel),
    startLocal: (trackId, options) => ipcRenderer.invoke(
      IPC_CHANNELS.lyricsLocalStart,
      trackId,
      options,
    ),
    cancelLocal: (trackId) => ipcRenderer.invoke(IPC_CHANNELS.lyricsLocalCancel, trackId),
    proofreadLocal: (trackId, update) => ipcRenderer.invoke(
      IPC_CHANNELS.lyricsLocalProofread,
      trackId,
      update,
    ),
    saveLocalDraft: (trackId, update) => ipcRenderer.invoke(
      IPC_CHANNELS.lyricsLocalSaveDraft,
      trackId,
      update,
    ),
    confirmLocalLrc: (trackId, update, overwriteExisting) => ipcRenderer.invoke(
      IPC_CHANNELS.lyricsLocalConfirmLrc,
      trackId,
      update,
      overwriteExisting,
    ),
    writeLocalTag: (trackId, update) => ipcRenderer.invoke(
      IPC_CHANNELS.lyricsLocalWriteTag,
      trackId,
      update,
    ),
    onLocalTaskChanged: (callback) => {
      const listener = (_event: Electron.IpcRendererEvent, task: LocalLyricsTask): void => {
        callback(task);
      };
      ipcRenderer.on(IPC_CHANNELS.lyricsLocalChanged, listener);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.lyricsLocalChanged, listener);
    },
    onLocalProofreadProgress: (callback) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        progress: LocalLyricsProofreadProgress,
      ): void => {
        callback(progress);
      };
      ipcRenderer.on(IPC_CHANNELS.lyricsLocalProofreadProgress, listener);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.lyricsLocalProofreadProgress, listener);
    },
    getBilingualTask: (trackId) => ipcRenderer.invoke(
      IPC_CHANNELS.lyricsBilingualTask,
      trackId,
    ),
    startBilingual: (trackId, options) => ipcRenderer.invoke(
      IPC_CHANNELS.lyricsBilingualStart,
      trackId,
      options,
    ),
    cancelBilingual: (trackId) => ipcRenderer.invoke(
      IPC_CHANNELS.lyricsBilingualCancel,
      trackId,
    ),
    writeBilingualTag: (trackId) => ipcRenderer.invoke(
      IPC_CHANNELS.lyricsBilingualWriteTag,
      trackId,
    ),
    onBilingualTaskChanged: (callback) => {
      const listener = (_event: Electron.IpcRendererEvent, task: BilingualLyricsTask): void => {
        callback(task);
      };
      ipcRenderer.on(IPC_CHANNELS.lyricsBilingualChanged, listener);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.lyricsBilingualChanged, listener);
    },
  },
  settings: {
    get: () => ipcRenderer.invoke(IPC_CHANNELS.settingsGet),
    chooseDownloadDirectory: () => ipcRenderer.invoke(
      IPC_CHANNELS.settingsChooseDownloadDirectory,
    ),
    updateProxy: (update) => ipcRenderer.invoke(IPC_CHANNELS.settingsUpdateProxy, update),
    updateMinio: (update) => ipcRenderer.invoke(IPC_CHANNELS.settingsUpdateMinio, update),
    clearMinio: () => ipcRenderer.invoke(IPC_CHANNELS.settingsClearMinio),
    chooseCookieFile: () => ipcRenderer.invoke(IPC_CHANNELS.settingsChooseCookieFile),
    clearCookie: () => ipcRenderer.invoke(IPC_CHANNELS.settingsClearCookie),
  },
  remote: {
    getSnapshot: () => ipcRenderer.invoke(IPC_CHANNELS.remoteSnapshot),
    refresh: () => ipcRenderer.invoke(IPC_CHANNELS.remoteRefresh),
    testConnection: () => ipcRenderer.invoke(IPC_CHANNELS.remoteTestConnection),
    syncAll: () => ipcRenderer.invoke(IPC_CHANNELS.remoteSyncAll),
    syncTrack: (trackId) => ipcRenderer.invoke(IPC_CHANNELS.remoteSyncTrack, trackId),
    onChanged: (callback) => {
      const listener = (_event: Electron.IpcRendererEvent, snapshot: RemoteMusicSnapshot): void => {
        callback(snapshot);
      };
      ipcRenderer.on(IPC_CHANNELS.remoteChanged, listener);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.remoteChanged, listener);
    },
  },
  music: {
    getRuntime: () => ipcRenderer.invoke(IPC_CHANNELS.musicRuntime),
    search: (keyword, limit) => ipcRenderer.invoke(IPC_CHANNELS.musicSearch, keyword, limit),
    getTasks: () => ipcRenderer.invoke(IPC_CHANNELS.musicTasks),
    startDownload: (request) => ipcRenderer.invoke(IPC_CHANNELS.musicDownloadStart, request),
    cancelDownload: (taskId) => ipcRenderer.invoke(IPC_CHANNELS.musicDownloadCancel, taskId),
    openDownloadDirectory: () => ipcRenderer.invoke(IPC_CHANNELS.musicOpenDownloadDirectory),
    onTaskChanged: (callback) => {
      const listener = (_event: Electron.IpcRendererEvent, task: MusicDownloadTask): void => {
        callback(task);
      };
      ipcRenderer.on(IPC_CHANNELS.musicDownloadChanged, listener);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.musicDownloadChanged, listener);
    },
  },
  app: {
    getVersion: () => ipcRenderer.invoke(IPC_CHANNELS.appVersion),
    setFullscreen: (fullscreen) => ipcRenderer.invoke(
      IPC_CHANNELS.appSetFullscreen,
      fullscreen,
    ),
    onOpenTask: (callback) => {
      const listener = (_event: Electron.IpcRendererEvent, target: LyricsTaskTarget): void => {
        callback(target);
      };
      ipcRenderer.on(IPC_CHANNELS.appOpenTask, listener);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.appOpenTask, listener);
    },
    onFullscreenChanged: (callback) => {
      const listener = (_event: Electron.IpcRendererEvent, fullscreen: boolean): void => {
        callback(fullscreen);
      };
      ipcRenderer.on(IPC_CHANNELS.appFullscreenChanged, listener);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.appFullscreenChanged, listener);
    },
    onPlaybackFlushRequested: (callback) => {
      const listener = (_event: Electron.IpcRendererEvent, requestId: string): void => {
        callback(requestId);
      };
      ipcRenderer.on(IPC_CHANNELS.playbackFlushRequested, listener);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.playbackFlushRequested, listener);
    },
    completePlaybackFlush: (requestId) => {
      ipcRenderer.send(IPC_CHANNELS.playbackFlushComplete, requestId);
    },
  },
};

contextBridge.exposeInMainWorld('lyralume', api);
