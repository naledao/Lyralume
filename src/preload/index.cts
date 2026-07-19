import { contextBridge, ipcRenderer, webUtils } from 'electron';
import type {
  LibrarySnapshot,
  LocalLyricsProofreadProgress,
  LocalLyricsTask,
  LyralumeApi,
  ScanProgress,
} from '../shared/contracts.js';

// Keep the sandboxed preload self-contained: sandboxed preloads may only require
// Electron and a small set of Node built-ins.
const IPC_CHANNELS = {
  librarySnapshot: 'library:snapshot',
  libraryChooseDirectory: 'library:choose-directory',
  libraryImportDropped: 'library:import-dropped',
  libraryUpdateMetadata: 'library:update-metadata',
  libraryRemoveTrack: 'library:remove-track',
  libraryRescan: 'library:rescan',
  libraryChanged: 'library:changed',
  libraryScanProgress: 'library:scan-progress',
  lyricsLoad: 'lyrics:load',
  lyricsWriteAdjustedTiming: 'lyrics:write-adjusted-timing',
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
  appVersion: 'app:version',
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
  lyrics: {
    load: (trackId) => ipcRenderer.invoke(IPC_CHANNELS.lyricsLoad, trackId),
    writeAdjustedTiming: (trackId, offsetMs, sourceRevision) => ipcRenderer.invoke(
      IPC_CHANNELS.lyricsWriteAdjustedTiming,
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
  },
  app: {
    getVersion: () => ipcRenderer.invoke(IPC_CHANNELS.appVersion),
  },
};

contextBridge.exposeInMainWorld('lyralume', api);
