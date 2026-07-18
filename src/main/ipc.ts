import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { app, dialog, ipcMain, type BrowserWindow, type OpenDialogOptions } from 'electron';
import {
  IPC_CHANNELS,
  type LyricsDocument,
  type TrackMetadataUpdate,
} from '../shared/contracts.js';
import { LibraryDatabase } from './library/database.js';
import { LibraryService } from './library/service.js';
import { readEmbeddedLyricsAsLrc } from './lyrics/kid3.js';
import { OnlineLyricsService } from './lyrics/online-lyrics-service.js';
import { logger } from './logging.js';

const TRACK_ID_PATTERN = /^[a-f0-9]{24}$/;

export function registerIpcHandlers(
  getWindow: () => BrowserWindow | null,
  database: LibraryDatabase,
  library: LibraryService,
  onlineLyrics: OnlineLyricsService,
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

  ipcMain.handle(
    IPC_CHANNELS.libraryUpdateMetadata,
    (_event, trackId: unknown, metadata: unknown) => {
      if (
        typeof trackId !== 'string'
        || !TRACK_ID_PATTERN.test(trackId)
        || !metadata
        || typeof metadata !== 'object'
      ) throw new Error('无效的歌曲信息保存参数');
      const candidate = metadata as TrackMetadataUpdate;
      const update: TrackMetadataUpdate = {};
      for (const field of ['title', 'artist', 'album'] as const) {
        if (candidate[field] === undefined) continue;
        if (typeof candidate[field] !== 'string') {
          throw new Error('歌曲名、艺术家和专辑必须是文本');
        }
        update[field] = candidate[field];
      }
      if (Object.keys(update).length === 0) throw new Error('没有需要保存的歌曲信息');
      return library.updateTrackMetadata(trackId, update);
    },
  );

  ipcMain.handle(IPC_CHANNELS.libraryRemoveTrack, (_event, trackId: unknown) => {
    if (typeof trackId !== 'string' || !TRACK_ID_PATTERN.test(trackId)) {
      throw new Error('无效的歌曲标识');
    }
    return library.removeTrack(trackId);
  });

  ipcMain.handle(IPC_CHANNELS.libraryImportDropped, (_event, droppedPaths: unknown) => {
    if (
      !Array.isArray(droppedPaths)
      || droppedPaths.length === 0
      || droppedPaths.length > 500
      || droppedPaths.some((item) => (
        typeof item !== 'string'
        || item.includes('\0')
        || !path.isAbsolute(item)
      ))
    ) throw new Error('没有识别到可导入的本地文件或文件夹');
    return library.addAndScanDropped([...new Set(droppedPaths)]);
  });

  ipcMain.handle(IPC_CHANNELS.lyricsLoad, async (_event, trackId: unknown): Promise<LyricsDocument> => {
    if (typeof trackId !== 'string' || !TRACK_ID_PATTERN.test(trackId)) {
      return { status: 'error', message: '无效的歌曲标识' };
    }
    const track = database.getTrackLocation(trackId);
    if (!track) return { status: 'missing' };
    if (track.lrcPath) {
      try {
        const raw = await readFile(track.lrcPath, 'utf8');
        return { status: 'loaded', raw, fileName: track.lrcPath.split(/[\\/]/).pop() };
      } catch (error) {
        logger.warn(`Unable to read LRC for track ${trackId}`, error);
      }
    }
    try {
      const raw = await readEmbeddedLyricsAsLrc(track.filePath);
      if (raw) return { status: 'loaded', raw, fileName: '内嵌同步歌词' };
    } catch (error) {
      logger.warn(`Unable to read embedded lyrics for track ${trackId}`, error);
    }
    return track.lrcPath
      ? { status: 'error', message: '歌词文件无法读取或已被移动' }
      : { status: 'missing' };
  });

  ipcMain.handle(IPC_CHANNELS.lyricsOnlineTask, (_event, trackId: unknown) => {
    if (typeof trackId !== 'string' || !TRACK_ID_PATTERN.test(trackId)) {
      throw new Error('无效的歌曲标识');
    }
    return onlineLyrics.getTask(trackId);
  });

  ipcMain.handle(IPC_CHANNELS.lyricsOnlineSearch, (_event, trackId: unknown) => {
    if (typeof trackId !== 'string' || !TRACK_ID_PATTERN.test(trackId)) {
      throw new Error('无效的歌曲标识');
    }
    return onlineLyrics.search(trackId);
  });

  ipcMain.handle(
    IPC_CHANNELS.lyricsOnlineSave,
    (_event, trackId: unknown, candidateId: unknown, overwriteExisting: unknown) => {
      if (
        typeof trackId !== 'string'
        || !TRACK_ID_PATTERN.test(trackId)
        || typeof candidateId !== 'number'
        || !Number.isInteger(candidateId)
        || (overwriteExisting !== undefined && typeof overwriteExisting !== 'boolean')
      ) throw new Error('无效的在线歌词保存参数');
      return onlineLyrics.save(trackId, candidateId, overwriteExisting === true);
    },
  );

  ipcMain.handle(IPC_CHANNELS.lyricsWriteTag, (_event, trackId: unknown, candidateId: unknown) => {
    if (
      typeof trackId !== 'string'
      || !TRACK_ID_PATTERN.test(trackId)
      || (candidateId !== undefined && (
        typeof candidateId !== 'number' || !Number.isInteger(candidateId)
      ))
    ) {
      throw new Error('无效的歌曲标识');
    }
    return onlineLyrics.writeTag(trackId, candidateId as number | undefined);
  });

  ipcMain.handle(IPC_CHANNELS.appVersion, () => app.getVersion());
}

export function removeIpcHandlers(): void {
  for (const channel of [
    IPC_CHANNELS.librarySnapshot,
    IPC_CHANNELS.libraryChooseDirectory,
    IPC_CHANNELS.libraryRescan,
    IPC_CHANNELS.libraryImportDropped,
    IPC_CHANNELS.libraryUpdateMetadata,
    IPC_CHANNELS.libraryRemoveTrack,
    IPC_CHANNELS.lyricsLoad,
    IPC_CHANNELS.lyricsOnlineTask,
    IPC_CHANNELS.lyricsOnlineSearch,
    IPC_CHANNELS.lyricsOnlineSave,
    IPC_CHANNELS.lyricsWriteTag,
    IPC_CHANNELS.appVersion,
  ]) {
    ipcMain.removeHandler(channel);
  }
}
