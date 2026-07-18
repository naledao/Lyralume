import { readFile } from 'node:fs/promises';
import { app, dialog, ipcMain, type BrowserWindow, type OpenDialogOptions } from 'electron';
import { IPC_CHANNELS, type LyricsDocument } from '../shared/contracts.js';
import { LibraryDatabase } from './library/database.js';
import { LibraryService } from './library/service.js';
import { logger } from './logging.js';

const TRACK_ID_PATTERN = /^[a-f0-9]{24}$/;

export function registerIpcHandlers(
  getWindow: () => BrowserWindow | null,
  database: LibraryDatabase,
  library: LibraryService,
): void {
  library.setListeners(
    (snapshot) => getWindow()?.webContents.send(IPC_CHANNELS.libraryChanged, snapshot),
    (progress) => getWindow()?.webContents.send(IPC_CHANNELS.libraryScanProgress, progress),
  );

  ipcMain.handle(IPC_CHANNELS.librarySnapshot, () => library.getSnapshot());

  ipcMain.handle(IPC_CHANNELS.libraryChooseDirectory, async () => {
    const owner = getWindow() ?? undefined;
    const options: OpenDialogOptions = {
      title: '选择音乐文件夹',
      properties: ['openDirectory'],
    };
    const result = owner ? await dialog.showOpenDialog(owner, options) : await dialog.showOpenDialog(options);
    if (result.canceled || result.filePaths.length === 0) return null;
    return library.addAndScan(result.filePaths[0]);
  });

  ipcMain.handle(IPC_CHANNELS.libraryRescan, () => library.rescanAll());

  ipcMain.handle(IPC_CHANNELS.lyricsLoad, async (_event, trackId: unknown): Promise<LyricsDocument> => {
    if (typeof trackId !== 'string' || !TRACK_ID_PATTERN.test(trackId)) {
      return { status: 'error', message: '无效的歌曲标识' };
    }
    const track = database.getTrackLocation(trackId);
    if (!track?.lrcPath) return { status: 'missing' };
    try {
      const raw = await readFile(track.lrcPath, 'utf8');
      return { status: 'loaded', raw, fileName: track.lrcPath.split(/[\\/]/).pop() };
    } catch (error) {
      logger.warn(`Unable to read LRC for track ${trackId}`, error);
      return { status: 'error', message: '歌词文件无法读取或已被移动' };
    }
  });

  ipcMain.handle(IPC_CHANNELS.appVersion, () => app.getVersion());
}

export function removeIpcHandlers(): void {
  for (const channel of [
    IPC_CHANNELS.librarySnapshot,
    IPC_CHANNELS.libraryChooseDirectory,
    IPC_CHANNELS.libraryRescan,
    IPC_CHANNELS.lyricsLoad,
    IPC_CHANNELS.appVersion,
  ]) {
    ipcMain.removeHandler(channel);
  }
}
