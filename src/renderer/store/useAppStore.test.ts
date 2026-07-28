import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LocalLyricsTask, LyralumeApi, Track } from '../../shared/contracts';
import { useAppStore } from './useAppStore';

const track = (id: string, title: string): Track => ({
  id,
  title,
  artist: 'Artist',
  album: 'Album',
  language: null,
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
    chooseArtwork: vi.fn(),
    removeTrack: vi.fn(),
    rescan: vi.fn(),
    onChanged: vi.fn(() => () => undefined),
    onScanProgress: vi.fn(() => () => undefined),
  },
  playback: {
    getState: vi.fn(),
    saveCheckpoint: vi.fn(),
  },
  visuals: {
    getAnalysis: vi.fn(),
    reanalyze: vi.fn(),
    onAnalysisChanged: vi.fn(() => () => undefined),
    onAnalysisProgress: vi.fn(() => () => undefined),
  },
  lyrics: {
    load: vi.fn(),
    getTasks: vi.fn(),
    setTaskStatusOverride: vi.fn(),
    writeAdjustedTiming: vi.fn(),
    writeSimplified: vi.fn(),
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
    getBilingualTask: vi.fn(),
    startBilingual: vi.fn(),
    cancelBilingual: vi.fn(),
    writeBilingualTag: vi.fn(),
    onBilingualTaskChanged: vi.fn(() => () => undefined),
  },
  settings: {
    get: vi.fn(),
    chooseDownloadDirectory: vi.fn(),
    updateProxy: vi.fn(),
    updateMinio: vi.fn(),
    clearMinio: vi.fn(),
    chooseCookieFile: vi.fn(),
    clearCookie: vi.fn(),
  },
  remote: {
    getSnapshot: vi.fn(),
    refresh: vi.fn(),
    testConnection: vi.fn(),
    syncAll: vi.fn(),
    syncTrack: vi.fn(),
    onChanged: vi.fn(() => () => undefined),
  },
  music: {
    getRuntime: vi.fn(),
    search: vi.fn(),
    getTasks: vi.fn(),
    startDownload: vi.fn(),
    cancelDownload: vi.fn(),
    openDownloadDirectory: vi.fn(),
    onTaskChanged: vi.fn(() => () => undefined),
  },
  app: {
    getVersion: vi.fn(),
    setFullscreen: vi.fn(),
    onOpenTask: vi.fn(() => () => undefined),
    onFullscreenChanged: vi.fn(() => () => undefined),
    onPlaybackFlushRequested: vi.fn(() => () => undefined),
    completePlaybackFlush: vi.fn(),
  },
} satisfies LyralumeApi;

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  window.lyralume = api;
  api.playback.getState.mockResolvedValue({ lastTrackId: null, progress: [] });
  api.lyrics.getTasks.mockResolvedValue({ local: [], bilingual: [] });
  api.playback.saveCheckpoint.mockImplementation(async (checkpoint) => ({
    ...checkpoint,
    updatedAt: 1,
  }));
  useAppStore.setState({
    tracks: [],
    activeView: 'library',
    taskDetailRequest: null,
    roots: [],
    queueIds: [],
    playbackMode: 'sequence',
    shuffleQueueIds: [],
    currentTrackId: null,
    isPlaying: false,
    currentTime: 0,
    duration: 0,
    playbackProgress: {},
    lyricsStatus: 'idle',
    lyricLines: [],
    lyricOffsetMs: 0,
    lyricsSource: null,
    lyricsRevision: null,
    simplifiedLyricsWriteBusy: false,
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
    bilingualLyricsTask: null,
    bilingualLyricsTasks: {},
    bilingualLyricsBusy: false,
    lyricsTasksLoading: false,
    lyricsTasksError: null,
    scanning: false,
    scanProgress: null,
    libraryMessage: null,
    visualsEnabled: true,
    visualQuality: 'balanced',
    visualIntensity: 1,
    visualReducedMotion: false,
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
  api.lyrics.getBilingualTask.mockResolvedValue({
    id: 'bilingual-333333333333333333333333',
    trackId: '333333333333333333333333',
    status: 'idle',
    progress: 0,
    message: '尚未创建中文双语草稿',
    targetLanguage: 'zh-CN',
    style: 'lyrical',
    lines: [],
    sources: [],
    tagWriteStatus: 'not_started',
    createdAt: 1,
    updatedAt: 1,
  });
});

describe('player store', () => {
  it('persists bounded visual accessibility and quality settings', () => {
    useAppStore.getState().setVisualQuality('high');
    useAppStore.getState().setVisualIntensity(9);
    useAppStore.getState().setVisualReducedMotion(true);

    expect(useAppStore.getState()).toMatchObject({
      visualQuality: 'high',
      visualIntensity: 1.35,
      visualReducedMotion: true,
    });
    expect(JSON.parse(window.localStorage.getItem('lyralume.visual-settings.v1') ?? '{}'))
      .toEqual({ quality: 'high', intensity: 1.35, reducedMotion: true });
  });

  it('resumes a selected track from its persisted playback position', () => {
    const item = track('101111111111111111111111', 'Resume');
    useAppStore.getState().applySnapshot({ tracks: [item], roots: [] });
    useAppStore.getState().applyPlaybackState({
      lastTrackId: item.id,
      progress: [{
        trackId: item.id,
        positionMs: 23_500,
        durationMs: 60_000,
        completed: false,
        reason: 'pause',
        updatedAt: 1,
      }],
    });

    useAppStore.getState().selectTrack(item.id, false);

    expect(useAppStore.getState()).toMatchObject({
      currentTrackId: item.id,
      currentTime: 23.5,
      duration: 60,
      isPlaying: false,
    });
  });

  it('starts completed tracks from the beginning', () => {
    const item = track('102222222222222222222222', 'Completed');
    useAppStore.getState().applySnapshot({ tracks: [item], roots: [] });
    useAppStore.getState().applyPlaybackState({
      lastTrackId: item.id,
      progress: [{
        trackId: item.id,
        positionMs: 0,
        durationMs: 60_000,
        completed: true,
        reason: 'ended',
        updatedAt: 1,
      }],
    });

    useAppStore.getState().selectTrack(item.id, false);

    expect(useAppStore.getState().currentTime).toBe(0);
  });

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

  it('cycles through sequence, shuffle and repeat-one modes', () => {
    expect(useAppStore.getState().playbackMode).toBe('sequence');
    useAppStore.getState().cyclePlaybackMode();
    expect(useAppStore.getState().playbackMode).toBe('shuffle');
    useAppStore.getState().cyclePlaybackMode();
    expect(useAppStore.getState().playbackMode).toBe('repeat-one');
    useAppStore.getState().cyclePlaybackMode();
    expect(useAppStore.getState().playbackMode).toBe('sequence');
  });

  it('plays every track once before reshuffling the list', () => {
    const tracks = [
      track('111111111111111111111111', 'One'),
      track('222222222222222222222222', 'Two'),
      track('333333333333333333333333', 'Three'),
      track('444444444444444444444444', 'Four'),
    ];
    api.lyrics.load.mockResolvedValue({ status: 'missing' });
    useAppStore.getState().applySnapshot({ tracks, roots: [] });
    useAppStore.getState().selectTrack(tracks[0].id);
    useAppStore.getState().setPlaybackMode('shuffle');

    const played = [useAppStore.getState().currentTrackId];
    for (let count = 0; count < tracks.length - 1; count += 1) {
      useAppStore.getState().nextTrack();
      played.push(useAppStore.getState().currentTrackId);
    }

    expect(new Set(played).size).toBe(tracks.length);
    expect(new Set(played)).toEqual(new Set(tracks.map((item) => item.id)));
    const previous = useAppStore.getState().currentTrackId;
    useAppStore.getState().nextTrack();
    expect(useAppStore.getState().currentTrackId).not.toBe(previous);
  });

  it('stops at the end in sequence mode and advances in the middle', () => {
    const first = track('111111111111111111111111', 'One');
    const second = track('222222222222222222222222', 'Two');
    api.lyrics.load.mockResolvedValue({ status: 'missing' });
    useAppStore.getState().applySnapshot({ tracks: [first, second], roots: [] });
    useAppStore.getState().selectTrack(first.id);
    useAppStore.getState().handleTrackEnded();
    expect(useAppStore.getState()).toMatchObject({ currentTrackId: second.id, isPlaying: true });

    useAppStore.getState().handleTrackEnded();
    expect(useAppStore.getState()).toMatchObject({ currentTrackId: second.id, isPlaying: false });
  });

  it('keeps the current track active when repeat-one ends', () => {
    const item = track('111111111111111111111111', 'One');
    useAppStore.getState().applySnapshot({ tracks: [item], roots: [] });
    useAppStore.getState().selectTrack(item.id);
    useAppStore.setState({ playbackMode: 'repeat-one', currentTime: 60 });

    useAppStore.getState().handleTrackEnded();

    expect(useAppStore.getState()).toMatchObject({
      currentTrackId: item.id,
      currentTime: 0,
      isPlaying: true,
    });
  });

  it('loads and parses local lyrics through the preload API', async () => {
    const item = track('333333333333333333333333', 'Lyrics');
    api.lyrics.load.mockResolvedValue({
      status: 'loaded',
      raw: '[offset:100]\n[00:01.00]Hello',
      source: 'lrc',
      revision: 'a'.repeat(64),
      preciseTiming: [{
        time: 1,
        endTime: 2,
        text: 'Hello',
        tokens: [{ text: 'Hello', startTime: 1, endTime: 2 }],
      }],
    });
    useAppStore.getState().applySnapshot({ tracks: [item], roots: [] });
    useAppStore.getState().selectTrack(item.id);
    await vi.waitFor(() => expect(useAppStore.getState().lyricsStatus).toBe('loaded'));
    expect(useAppStore.getState().lyricLines[0].text).toBe('Hello');
    expect(useAppStore.getState().lyricLines[0].tokens).toEqual([
      { text: 'Hello', startTime: 1, endTime: 2 },
    ]);
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

  it('writes simplified lyrics into the original MP3 and reloads the verified embedded frame', async () => {
    const item = { ...track('777777777777777777777777', 'Traditional'), fileName: 'Traditional.mp3' };
    useAppStore.setState({
      tracks: [item],
      queueIds: [item.id],
      currentTrackId: item.id,
      lyricsStatus: 'loaded',
      lyricLines: [{ id: '1', time: 2, text: '還不能回來' }],
      lyricOffsetMs: 500,
      lyricsSource: 'lrc',
      lyricsRevision: '7'.repeat(64),
    });
    api.lyrics.writeSimplified.mockResolvedValue({
      appliedOffsetMs: 500,
      lineCount: 1,
      changedLineCount: 1,
      source: 'lrc',
    });
    api.lyrics.load.mockResolvedValue({
      status: 'loaded',
      raw: '[00:02.500]还不能回来',
      source: 'embedded',
      revision: '8'.repeat(64),
    });

    await expect(useAppStore.getState().writeSimplifiedLyrics()).resolves.toBe(true);

    expect(api.lyrics.writeSimplified).toHaveBeenCalledWith(
      item.id,
      500,
      '7'.repeat(64),
    );
    expect(useAppStore.getState()).toMatchObject({
      lyricOffsetMs: 0,
      lyricsSource: 'embedded',
      simplifiedLyricsWriteBusy: false,
    });
    expect(useAppStore.getState().libraryMessage).toBe(
      '已转换 1 行，并将共 1 行写入《Traditional》原 MP3 并通过回读验证',
    );
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

  it('shows why a dropped MP3 was rejected when text lyrics cannot be converted', async () => {
    const dropped = new File(['audio'], 'Plain Lyrics.mp3', { type: 'audio/mpeg' });
    api.library.importDropped.mockResolvedValue({
      tracks: [],
      roots: [{ path: 'local-source', addedAt: 1 }],
      scannedFiles: 1,
      importedTracks: 0,
      warnings: [{
        fileName: 'Plain Lyrics.mp3',
        message: '内嵌 text 歌词不包含有效的 LRC 同步时间戳',
      }],
    });

    await useAppStore.getState().importDropped([dropped]);

    expect(useAppStore.getState().libraryMessage).toBe(
      '已导入 0 首，1 个项目无法读取：Plain Lyrics.mp3（内嵌 text 歌词不包含有效的 LRC 同步时间戳）',
    );
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

  it('writes a reviewed bilingual draft to the embedded lyrics tag and reloads it', async () => {
    const item = track('888888888888888888888888', 'Bilingual');
    const task = {
      id: 'f2f3ff7b-4a75-4dd0-9f07-5c5f61bd05e2',
      trackId: item.id,
      status: 'review' as const,
      progress: 1,
      message: '双语同步歌词已写入 MP3 并通过回读验证',
      targetLanguage: 'zh-CN' as const,
      style: 'lyrical' as const,
      sourceRevision: 'a'.repeat(64),
      lines: [{
        id: '1.000-0',
        time: 1,
        originalText: 'First line',
        translatedText: '第一行',
      }],
      sources: [],
      tagWriteStatus: 'verified' as const,
      createdAt: 1,
      updatedAt: 2,
    };
    useAppStore.setState({
      tracks: [item],
      currentTrackId: item.id,
      bilingualLyricsTask: { ...task, tagWriteStatus: 'not_started' },
    });
    api.lyrics.writeBilingualTag.mockResolvedValue(task);
    api.lyrics.load.mockResolvedValue({
      status: 'loaded',
      raw: '[00:01.00]First line\n[00:01.00]第一行\n',
      source: 'embedded',
      revision: 'b'.repeat(64),
    });

    await expect(useAppStore.getState().writeBilingualLyricsTag()).resolves.toEqual(task);

    expect(api.lyrics.writeBilingualTag).toHaveBeenCalledWith(item.id);
    expect(api.lyrics.load).toHaveBeenCalledWith(item.id);
    expect(useAppStore.getState()).toMatchObject({
      bilingualLyricsBusy: false,
      bilingualLyricsTask: task,
      lyricsStatus: 'loaded',
      lyricsSource: 'embedded',
    });
  });

  it('keeps global task records and opens a task without starting playback', () => {
    const item = track('999999999999999999999999', 'Background task');
    const task: LocalLyricsTask = {
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      trackId: item.id,
      status: 'review',
      stage: 'draft',
      progress: 1,
      message: '草稿已生成，等待校对',
      draftLines: [{
        id: 'line-1',
        startTime: 1,
        endTime: 2,
        text: 'line',
        confidence: 1,
        flags: [],
      }],
      draftOffsetMs: 0,
      lowConfidenceCount: 0,
      lrcSaveStatus: 'not_started',
      tagWriteStatus: 'not_started',
      createdAt: 1,
      updatedAt: 2,
    };
    useAppStore.getState().applySnapshot({ tracks: [item], roots: [] });
    useAppStore.getState().applyLyricsTaskSnapshot({ local: [task], bilingual: [] });

    useAppStore.getState().openLyricsTask('local', item.id);

    expect(useAppStore.getState()).toMatchObject({
      activeView: 'tasks',
      currentTrackId: item.id,
      isPlaying: false,
      localLyricsTask: task,
      taskDetailRequest: {
        kind: 'local',
        trackId: item.id,
        requestId: 1,
      },
    });
  });

  it('persists a forced task status through the isolated preload API', async () => {
    const item = track('aaaaaaaaaaaaaaaaaaaaaaaa', 'Manual status');
    const task: LocalLyricsTask = {
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      trackId: item.id,
      status: 'review',
      stage: 'draft',
      progress: 1,
      message: '等待校对',
      draftLines: [],
      draftOffsetMs: 0,
      lowConfidenceCount: 0,
      lrcSaveStatus: 'not_started',
      tagWriteStatus: 'not_started',
      createdAt: 1,
      updatedAt: 2,
    };
    const resolved = { ...task, statusOverride: 'resolved' as const, updatedAt: 3 };
    useAppStore.setState({ tracks: [item], localLyricsTasks: { [item.id]: task } });
    api.lyrics.setTaskStatusOverride.mockResolvedValue({ kind: 'local', task: resolved });

    await useAppStore.getState().setLyricsTaskStatusOverride('local', item.id, 'resolved');

    expect(api.lyrics.setTaskStatusOverride).toHaveBeenCalledWith(
      { kind: 'local', trackId: item.id },
      'resolved',
    );
    expect(useAppStore.getState().localLyricsTasks[item.id]).toEqual(resolved);
  });
});
