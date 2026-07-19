import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LyralumeApi, Track } from '../../shared/contracts';
import { useAppStore } from './useAppStore';

const track = (id: string, title: string): Track => ({
  id,
  title,
  artist: 'Artist',
  album: 'Album',
  fileName: `${title}.flac`,
  duration: 60,
  fileSize: 100,
  modifiedAt: 1,
  hasLyrics: true,
  hasArtwork: false,
  playbackUrl: `lyralume-media://track/${id}`,
});

const api = {
  library: {
    getSnapshot: vi.fn(),
    chooseDirectory: vi.fn(),
    importDropped: vi.fn(),
    updateMetadata: vi.fn(),
    removeTrack: vi.fn(),
    rescan: vi.fn(),
    onChanged: vi.fn(() => () => undefined),
    onScanProgress: vi.fn(() => () => undefined),
  },
  lyrics: {
    load: vi.fn(),
    writeAdjustedTiming: vi.fn(),
    getOnlineTask: vi.fn(),
    searchOnline: vi.fn(),
    saveOnline: vi.fn(),
    writeTag: vi.fn(),
    getLocalTask: vi.fn(),
    getLocalModelSettings: vi.fn(),
    chooseLocalUvrModel: vi.fn(),
    resetLocalUvrModel: vi.fn(),
    startLocal: vi.fn(),
    cancelLocal: vi.fn(),
    proofreadLocal: vi.fn(),
    saveLocalDraft: vi.fn(),
    confirmLocalLrc: vi.fn(),
    writeLocalTag: vi.fn(),
    onLocalTaskChanged: vi.fn(() => () => undefined),
    onLocalProofreadProgress: vi.fn(() => () => undefined),
  },
  app: { getVersion: vi.fn() },
} satisfies LyralumeApi;

beforeEach(() => {
  vi.clearAllMocks();
  window.lyralume = api;
  useAppStore.setState({
    tracks: [],
    roots: [],
    queueIds: [],
    currentTrackId: null,
    isPlaying: false,
    currentTime: 0,
    duration: 0,
    lyricsStatus: 'idle',
    lyricLines: [],
    lyricOffsetMs: 0,
    lyricsSource: null,
    lyricsRevision: null,
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
    scanning: false,
    scanProgress: null,
    libraryMessage: null,
  });
  api.lyrics.getOnlineTask.mockResolvedValue({
    id: 'online-test',
    trackId: '333333333333333333333333',
    status: 'idle',
    source: 'lrclib',
    candidates: [],
    lrcSaveStatus: 'not_started',
    tagWriteStatus: 'not_started',
    updatedAt: 1,
  });
  api.lyrics.getLocalTask.mockResolvedValue({
    id: 'local-333333333333333333333333',
    trackId: '333333333333333333333333',
    status: 'idle',
    stage: 'pending',
    progress: 0,
    message: '尚未创建本地歌词草稿',
    draftLines: [],
    draftOffsetMs: 0,
    lowConfidenceCount: 0,
    lrcSaveStatus: 'not_started',
    tagWriteStatus: 'not_started',
    createdAt: 1,
    updatedAt: 1,
  });
});

describe('player store', () => {
  it('keeps a bounded per-track Codex workflow', () => {
    const trackId = '111111111111111111111111';
    useAppStore.getState().applyLocalLyricsProofreadProgress({
      trackId,
      stage: 'searching',
      message: '联网检索完成',
      detail: '歌曲 歌词',
      elapsedMs: 500,
      timestamp: 1,
    });

    expect(useAppStore.getState().localLyricsProofreadProgress[trackId]).toEqual([
      expect.objectContaining({ stage: 'searching', detail: '歌曲 歌词' }),
    ]);
  });

  it('remembers a local lyrics task after switching to another track', () => {
    const first = track('111111111111111111111111', 'One');
    const second = track('222222222222222222222222', 'Two');
    useAppStore.getState().applySnapshot({ tracks: [first, second], roots: [] });
    useAppStore.setState({ currentTrackId: first.id });
    useAppStore.getState().applyLocalLyricsTask({
      id: '62fa754e-65f0-4148-b68b-22278102ef18',
      trackId: first.id,
      status: 'separating',
      stage: 'separation',
      progress: 0.35,
      message: '正在分离',
      draftLines: [],
      draftOffsetMs: 0,
      lowConfidenceCount: 0,
      lrcSaveStatus: 'not_started',
      tagWriteStatus: 'not_started',
      createdAt: 1,
      updatedAt: 2,
    });

    useAppStore.getState().selectTrack(second.id, false);

    expect(useAppStore.getState().localLyricsTask).toBeNull();
    expect(useAppStore.getState().localLyricsTasks[first.id]).toMatchObject({
      status: 'separating',
      progress: 0.35,
    });
  });

  it('keeps a stable queue and wraps at the end', () => {
    const first = track('111111111111111111111111', 'One');
    const second = track('222222222222222222222222', 'Two');
    api.lyrics.load.mockResolvedValue({ status: 'missing' });
    useAppStore.getState().applySnapshot({ tracks: [first, second], roots: [] });
    useAppStore.getState().selectTrack(second.id);
    useAppStore.getState().nextTrack();
    expect(useAppStore.getState().currentTrackId).toBe(first.id);
    expect(useAppStore.getState().isPlaying).toBe(true);
  });

  it('loads and parses local lyrics through the preload API', async () => {
    const item = track('333333333333333333333333', 'Lyrics');
    api.lyrics.load.mockResolvedValue({
      status: 'loaded',
      raw: '[offset:100]\n[00:01.00]Hello',
      source: 'lrc',
      revision: 'a'.repeat(64),
    });
    useAppStore.getState().applySnapshot({ tracks: [item], roots: [] });
    useAppStore.getState().selectTrack(item.id);
    await vi.waitFor(() => expect(useAppStore.getState().lyricsStatus).toBe('loaded'));
    expect(useAppStore.getState().lyricLines[0].text).toBe('Hello');
    expect(useAppStore.getState().lyricOffsetMs).toBe(100);
    expect(useAppStore.getState()).toMatchObject({
      lyricsSource: 'lrc',
      lyricsRevision: 'a'.repeat(64),
    });
  });

  it('writes adjusted timing into the audio and reloads the verified embedded lyrics', async () => {
    const item = track('888888888888888888888888', 'Adjusted');
    useAppStore.setState({
      tracks: [item],
      queueIds: [item.id],
      currentTrackId: item.id,
      lyricsStatus: 'loaded',
      lyricLines: [{ id: '1', time: 2, text: 'Line' }],
      lyricOffsetMs: -2_000,
      lyricsSource: 'lrc',
      lyricsRevision: 'b'.repeat(64),
    });
    api.lyrics.writeAdjustedTiming.mockResolvedValue({
      appliedOffsetMs: -2_000,
      lineCount: 1,
      source: 'lrc',
    });
    api.lyrics.load.mockResolvedValue({
      status: 'loaded',
      raw: '[00:00.000]Line',
      source: 'embedded',
      revision: 'c'.repeat(64),
    });

    await expect(useAppStore.getState().writeAdjustedLyricTiming()).resolves.toBe(true);

    expect(api.lyrics.writeAdjustedTiming).toHaveBeenCalledWith(
      item.id,
      -2_000,
      'b'.repeat(64),
    );
    expect(useAppStore.getState()).toMatchObject({
      lyricOffsetMs: 0,
      lyricsSource: 'embedded',
      lyricTimingWriteBusy: false,
      lyricTimingWriteError: null,
      lyricTimingWriteMessage: '已将 -2.0s 应用到 1 行并写入原音频',
    });
  });

  it('imports dropped local files through the isolated preload API', async () => {
    const item = track('444444444444444444444444', 'Dropped');
    const dropped = new File(['audio'], 'Dropped.flac', { type: 'audio/flac' });
    api.library.importDropped.mockResolvedValue({
      tracks: [item],
      roots: [{ path: 'local-source', addedAt: 1 }],
      scannedFiles: 1,
      importedTracks: 1,
      warnings: [],
    });

    await useAppStore.getState().importDropped([dropped]);

    expect(api.library.importDropped).toHaveBeenCalledWith([dropped]);
    expect(useAppStore.getState().tracks[0].title).toBe('Dropped');
    expect(useAppStore.getState().libraryMessage).toBe('已导入 1 首歌曲');
  });

  it('queues a dropped file instead of silently ignoring it during a scan', async () => {
    const item = track('666666666666666666666666', 'Queued');
    const dropped = new File(['audio'], 'Queued.flac', { type: 'audio/flac' });
    useAppStore.setState({
      scanning: true,
      scanProgress: { rootPath: 'existing-root', processed: 1, total: 1 },
    });
    api.library.importDropped.mockResolvedValue({
      tracks: [item],
      roots: [{ path: 'queued-source', addedAt: 1 }],
      scannedFiles: 1,
      importedTracks: 1,
      warnings: [],
    });

    await useAppStore.getState().importDropped([dropped]);

    expect(api.library.importDropped).toHaveBeenCalledWith([dropped]);
    expect(useAppStore.getState()).toMatchObject({
      scanning: false,
      scanProgress: null,
      tracks: [item],
    });
  });

  it('clears the scanning indicator when the main process reports completion', () => {
    useAppStore.getState().setScanProgress({ rootPath: 'root', processed: 1, total: 1 });
    expect(useAppStore.getState().scanning).toBe(true);

    useAppStore.getState().setScanProgress({
      rootPath: 'root',
      processed: 1,
      total: 1,
      completed: true,
    });

    expect(useAppStore.getState()).toMatchObject({ scanning: false, scanProgress: null });
  });

  it('removes a song from the library and clears active playback state', async () => {
    const item = track('555555555555555555555555', 'Removed');
    useAppStore.setState({
      tracks: [item],
      queueIds: [item.id],
      currentTrackId: item.id,
      isPlaying: true,
      currentTime: 12,
      duration: 60,
      lyricsStatus: 'loaded',
      lyricLines: [{ id: '1', time: 1, text: 'Line' }],
    });
    api.library.removeTrack.mockResolvedValue({ tracks: [], roots: [] });

    await expect(useAppStore.getState().removeTrack(item.id)).resolves.toBe(true);

    expect(api.library.removeTrack).toHaveBeenCalledWith(item.id);
    expect(useAppStore.getState()).toMatchObject({
      tracks: [],
      queueIds: [],
      currentTrackId: null,
      isPlaying: false,
      currentTime: 0,
      duration: 0,
      lyricsStatus: 'idle',
      lyricLines: [],
      libraryMessage: '已移除《Removed》，电脑上的音乐文件未删除',
    });
  });

  it('saves edited artist and album values through the isolated preload API', async () => {
    const item = track('777777777777777777777777', 'Editable');
    const updated = {
      ...item,
      title: 'New Title',
      artist: 'New Artist',
      album: 'New Album',
    };
    useAppStore.getState().applySnapshot({ tracks: [item], roots: [] });
    api.library.updateMetadata.mockResolvedValue({ tracks: [updated], roots: [] });

    await expect(
      useAppStore.getState().updateTrackMetadata(
        item.id,
        {
          title: 'New Title',
          artist: 'New Artist',
          album: 'New Album',
        },
      ),
    ).resolves.toBe(true);

    expect(api.library.updateMetadata).toHaveBeenCalledWith(item.id, {
      title: 'New Title',
      artist: 'New Artist',
      album: 'New Album',
    });
    expect(useAppStore.getState()).toMatchObject({
      tracks: [updated],
      libraryMessage: '已将《New Title》的歌曲信息写入原文件并验证',
    });
  });
});
