import { contextBridge, ipcRenderer } from 'electron';
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
  libraryRescan: 'library:rescan',
  libraryChanged: 'library:changed',
  libraryScanProgress: 'library:scan-progress',
  lyricsLoad: 'lyrics:load',
  appVersion: 'app:version',
} as const;

const api: LyralumeApi = {
  library: {
    getSnapshot: () => ipcRenderer.invoke(IPC_CHANNELS.librarySnapshot),
    chooseDirectory: () => ipcRenderer.invoke(IPC_CHANNELS.libraryChooseDirectory),
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
  },
  app: {
    getVersion: () => ipcRenderer.invoke(IPC_CHANNELS.appVersion),
  },
};

contextBridge.exposeInMainWorld('lyralume', api);
