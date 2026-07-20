import path from 'node:path';
import { app, dialog, ipcMain, type BrowserWindow, type OpenDialogOptions } from 'electron';
import {
  IPC_CHANNELS,
  isTrackLanguage,
  type BilingualLyricsStartOptions,
  type LocalLyricsDraftUpdate,
  type LocalLyricsStartOptions,
  type LyricsDocument,
  type PlaybackCheckpoint,
  type TrackMetadataUpdate,
} from '../shared/contracts.js';
import { LibraryDatabase } from './library/database.js';
import { LibraryService } from './library/service.js';
import { BilingualLyricsService } from './lyrics/bilingual-lyrics-service.js';
import { LyricsOffsetService } from './lyrics/lyrics-offset-service.js';
import { loadPreferredLyricsSource } from './lyrics/lyrics-source.js';
import { preciseTimingForLocalTask } from './lyrics/precise-timing.js';
import { OnlineLyricsService } from './lyrics/online-lyrics-service.js';
import { LocalLyricsService } from './local-lyrics/local-lyrics-service.js';
import { logger } from './logging.js';
import { setImmersiveFullscreen } from './immersive-fullscreen.js';
import { VisualAnalysisService } from './visual-analysis/service.js';

const TRACK_ID_PATTERN = /^[a-f0-9]{24}$/;
const PLAYBACK_CHECKPOINT_REASONS = new Set<PlaybackCheckpoint['reason']>([
  'periodic',
  'track-selected',
  'track-switch',
  'pause',
  'seek',
  'file-operation',
  'app-hidden',
  'app-close',
  'ended',
]);

export function registerIpcHandlers(
  getWindow: () => BrowserWindow | null,
  database: LibraryDatabase,
  library: LibraryService,
  onlineLyrics: OnlineLyricsService,
  localLyrics: LocalLyricsService,
  bilingualLyrics: BilingualLyricsService,
  lyricsOffset: LyricsOffsetService,
  visualAnalysis: VisualAnalysisService,
): void {
  library.setListeners(
    (snapshot) => {
      getWindow()?.webContents.send(IPC_CHANNELS.libraryChanged, snapshot);
      visualAnalysis.scheduleLibrary(snapshot.tracks);
    },
    (progress) => getWindow()?.webContents.send(IPC_CHANNELS.libraryScanProgress, progress),
  );
  localLyrics.setListener((task) => {
    getWindow()?.webContents.send(IPC_CHANNELS.lyricsLocalChanged, task);
  });
  bilingualLyrics.setListener((task) => {
    getWindow()?.webContents.send(IPC_CHANNELS.lyricsBilingualChanged, task);
  });
  visualAnalysis.setListeners(
    (analysis) => getWindow()?.webContents.send(IPC_CHANNELS.visualAnalysisChanged, analysis),
    (progress) => getWindow()?.webContents.send(IPC_CHANNELS.visualAnalysisProgress, progress),
  );

  ipcMain.handle(IPC_CHANNELS.librarySnapshot, () => library.getSnapshot());

  ipcMain.handle(IPC_CHANNELS.playbackState, () => database.getPlaybackState());

  ipcMain.handle(IPC_CHANNELS.playbackCheckpoint, (_event, checkpoint: unknown) => {
    assertPlaybackCheckpoint(checkpoint);
    if (!database.getTrackLocation(checkpoint.trackId)) {
      throw new Error('音乐库中找不到这首歌曲');
    }
    return database.savePlaybackCheckpoint(checkpoint);
  });

  ipcMain.handle(IPC_CHANNELS.visualAnalysisGet, (_event, trackId: unknown) => {
    if (typeof trackId !== 'string' || !TRACK_ID_PATTERN.test(trackId)) {
      throw new Error('无效的歌曲 ID');
    }
    return visualAnalysis.get(trackId);
  });

  ipcMain.handle(IPC_CHANNELS.visualAnalysisRun, (_event, trackId: unknown) => {
    if (typeof trackId !== 'string' || !TRACK_ID_PATTERN.test(trackId)) {
      throw new Error('无效的歌曲 ID');
    }
    return visualAnalysis.reanalyze(trackId);
  });

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
      if (candidate.language !== undefined) {
        if (candidate.language !== '' && !isTrackLanguage(candidate.language)) {
          throw new Error('不支持的歌曲语种');
        }
        update.language = candidate.language;
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
    const source = await loadPreferredLyricsSource(track);
    if (source) {
      const preciseTiming = preciseTimingForLocalTask(
        database.getLocalLyricsTask(trackId),
        source.source,
      );
      return { status: 'loaded', ...source, ...(preciseTiming ? { preciseTiming } : {}) };
    }
    return track.lrcPath
      ? { status: 'error', message: '歌词文件无法读取或已被移动' }
      : { status: 'missing' };
  });

  ipcMain.handle(
    IPC_CHANNELS.lyricsWriteAdjustedTiming,
    (_event, trackId: unknown, offsetMs: unknown, sourceRevision: unknown) => {
      assertTrackId(trackId);
      if (
        typeof offsetMs !== 'number'
        || !Number.isSafeInteger(offsetMs)
        || typeof sourceRevision !== 'string'
        || !/^[a-f0-9]{64}$/.test(sourceRevision)
      ) throw new Error('无效的歌词偏移写入参数');
      return lyricsOffset.writeAdjustedTiming(trackId, offsetMs, sourceRevision);
    },
  );

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

  ipcMain.handle(IPC_CHANNELS.lyricsLocalTask, (_event, trackId: unknown) => {
    assertTrackId(trackId);
    return localLyrics.getTask(trackId);
  });

  ipcMain.handle(IPC_CHANNELS.lyricsLocalModelSettings, () => localLyrics.getModelSettings());

  ipcMain.handle(IPC_CHANNELS.lyricsLocalChooseUvrModel, async () => {
    const owner = getWindow() ?? undefined;
    const options: OpenDialogOptions = {
      title: '选择已下载的 UVR 模型',
      properties: ['openFile'],
      filters: [
        { name: 'UVR 模型', extensions: ['ckpt', 'pt', 'pth'] },
        { name: '所有文件', extensions: ['*'] },
      ],
    };
    const result = owner ? await dialog.showOpenDialog(owner, options) : await dialog.showOpenDialog(options);
    if (result.canceled || result.filePaths.length === 0) return null;
    return localLyrics.setCustomUvrModel(result.filePaths[0]);
  });

  ipcMain.handle(IPC_CHANNELS.lyricsLocalResetUvrModel, () => localLyrics.resetUvrModel());

  ipcMain.handle(IPC_CHANNELS.lyricsLocalStart, (_event, trackId: unknown, options: unknown) => {
    assertTrackId(trackId);
    if (options !== undefined && (
      !options
      || typeof options !== 'object'
      || ('language' in options && typeof (options as { language?: unknown }).language !== 'string')
      || ('device' in options && !['cuda', 'cpu'].includes(String((options as { device?: unknown }).device)))
    )) throw new Error('无效的本地歌词任务选项');
    return localLyrics.start(trackId, (options ?? {}) as LocalLyricsStartOptions);
  });

  ipcMain.handle(IPC_CHANNELS.lyricsLocalCancel, (_event, trackId: unknown) => {
    assertTrackId(trackId);
    return localLyrics.cancel(trackId);
  });

  ipcMain.handle(
    IPC_CHANNELS.lyricsLocalProofread,
    (event, trackId: unknown, update: unknown) => {
      assertTrackId(trackId);
      assertDraftUpdate(update);
      return localLyrics.proofread(trackId, update, (progress) => {
        if (!event.sender.isDestroyed()) {
          event.sender.send(IPC_CHANNELS.lyricsLocalProofreadProgress, progress);
        }
      });
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.lyricsLocalSaveDraft,
    (_event, trackId: unknown, update: unknown) => {
      assertTrackId(trackId);
      assertDraftUpdate(update);
      return localLyrics.saveDraft(trackId, update);
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.lyricsLocalConfirmLrc,
    (_event, trackId: unknown, update: unknown, overwriteExisting: unknown) => {
      assertTrackId(trackId);
      assertDraftUpdate(update);
      if (overwriteExisting !== undefined && typeof overwriteExisting !== 'boolean') {
        throw new Error('无效的 LRC 覆盖选项');
      }
      return localLyrics.confirmLrc(trackId, update, overwriteExisting === true);
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.lyricsLocalWriteTag,
    (_event, trackId: unknown, update: unknown) => {
      assertTrackId(trackId);
      assertDraftUpdate(update);
      return localLyrics.writeTag(trackId, update);
    },
  );

  ipcMain.handle(IPC_CHANNELS.lyricsBilingualTask, (_event, trackId: unknown) => {
    assertTrackId(trackId);
    return bilingualLyrics.getTask(trackId);
  });

  ipcMain.handle(IPC_CHANNELS.lyricsBilingualStart, (_event, trackId: unknown, options: unknown) => {
    assertTrackId(trackId);
    if (options !== undefined && (
      !options
      || typeof options !== 'object'
      || ('style' in options && !['natural', 'lyrical', 'singable'].includes(
        String((options as { style?: unknown }).style),
      ))
    )) throw new Error('无效的双语译配选项');
    return bilingualLyrics.start(trackId, (options ?? {}) as BilingualLyricsStartOptions);
  });

  ipcMain.handle(IPC_CHANNELS.lyricsBilingualCancel, (_event, trackId: unknown) => {
    assertTrackId(trackId);
    return bilingualLyrics.cancel(trackId);
  });

  ipcMain.handle(IPC_CHANNELS.lyricsBilingualWriteTag, (_event, trackId: unknown) => {
    assertTrackId(trackId);
    return bilingualLyrics.writeTag(trackId);
  });

  ipcMain.handle(IPC_CHANNELS.appVersion, () => app.getVersion());

  ipcMain.handle(IPC_CHANNELS.appSetFullscreen, (event, fullscreen: unknown) => {
    if (typeof fullscreen !== 'boolean') {
      throw new Error('无效的全屏状态');
    }
    const window = getWindow();
    if (!window || window.isDestroyed() || window.webContents !== event.sender) {
      throw new Error('播放器窗口不可用');
    }
    return setImmersiveFullscreen(window, fullscreen);
  });
}

export function removeIpcHandlers(): void {
  for (const channel of [
    IPC_CHANNELS.librarySnapshot,
    IPC_CHANNELS.libraryChooseDirectory,
    IPC_CHANNELS.libraryRescan,
    IPC_CHANNELS.libraryImportDropped,
    IPC_CHANNELS.libraryUpdateMetadata,
    IPC_CHANNELS.libraryRemoveTrack,
    IPC_CHANNELS.playbackState,
    IPC_CHANNELS.playbackCheckpoint,
    IPC_CHANNELS.visualAnalysisGet,
    IPC_CHANNELS.visualAnalysisRun,
    IPC_CHANNELS.lyricsLoad,
    IPC_CHANNELS.lyricsWriteAdjustedTiming,
    IPC_CHANNELS.lyricsOnlineTask,
    IPC_CHANNELS.lyricsOnlineSearch,
    IPC_CHANNELS.lyricsOnlineSave,
    IPC_CHANNELS.lyricsWriteTag,
    IPC_CHANNELS.lyricsLocalTask,
    IPC_CHANNELS.lyricsLocalModelSettings,
    IPC_CHANNELS.lyricsLocalChooseUvrModel,
    IPC_CHANNELS.lyricsLocalResetUvrModel,
    IPC_CHANNELS.lyricsLocalStart,
    IPC_CHANNELS.lyricsLocalCancel,
    IPC_CHANNELS.lyricsLocalProofread,
    IPC_CHANNELS.lyricsLocalSaveDraft,
    IPC_CHANNELS.lyricsLocalConfirmLrc,
    IPC_CHANNELS.lyricsLocalWriteTag,
    IPC_CHANNELS.lyricsBilingualTask,
    IPC_CHANNELS.lyricsBilingualStart,
    IPC_CHANNELS.lyricsBilingualCancel,
    IPC_CHANNELS.lyricsBilingualWriteTag,
    IPC_CHANNELS.appVersion,
    IPC_CHANNELS.appSetFullscreen,
  ]) {
    ipcMain.removeHandler(channel);
  }
}

function assertTrackId(trackId: unknown): asserts trackId is string {
  if (typeof trackId !== 'string' || !TRACK_ID_PATTERN.test(trackId)) {
    throw new Error('无效的歌曲标识');
  }
}

function assertPlaybackCheckpoint(
  checkpoint: unknown,
): asserts checkpoint is PlaybackCheckpoint {
  if (!checkpoint || typeof checkpoint !== 'object') {
    throw new Error('无效的播放进度');
  }
  const candidate = checkpoint as Partial<PlaybackCheckpoint>;
  assertTrackId(candidate.trackId);
  if (
    !Number.isSafeInteger(candidate.positionMs)
    || !Number.isSafeInteger(candidate.durationMs)
    || (candidate.positionMs ?? -1) < 0
    || (candidate.durationMs ?? -1) < 0
    || (candidate.positionMs ?? 0) > 2_147_483_647
    || (candidate.durationMs ?? 0) > 2_147_483_647
    || typeof candidate.completed !== 'boolean'
    || !candidate.reason
    || !PLAYBACK_CHECKPOINT_REASONS.has(candidate.reason)
  ) throw new Error('无效的播放进度');
}

function assertDraftUpdate(update: unknown): asserts update is LocalLyricsDraftUpdate {
  if (
    !update
    || typeof update !== 'object'
    || !Array.isArray((update as { lines?: unknown }).lines)
    || (update as { lines: unknown[] }).lines.length > 10_000
    || typeof (update as { offsetMs?: unknown }).offsetMs !== 'number'
  ) throw new Error('无效的歌词草稿更新');
}
