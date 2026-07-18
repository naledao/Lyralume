import { contextBridge, ipcRenderer, webUtils } from 'electron';
import type {
  LibrarySnapshot,
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
  lyricsOnlineTask: 'lyrics:online-task',
  lyricsOnlineSearch: 'lyrics:online-search',
  lyricsOnlineSave: 'lyrics:online-save',
  lyricsWriteTag: 'lyrics:write-tag',
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
  },
  app: {
    getVersion: () => ipcRenderer.invoke(IPC_CHANNELS.appVersion),
  },
};

contextBridge.exposeInMainWorld('lyralume', api);
