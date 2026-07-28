import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LyralumeApi, Track } from '../../shared/contracts';
import { useAppStore } from '../store/useAppStore';
import { TrackList } from './TrackList';

const item: Track = {
  id: '888888888888888888888888',
  title: 'Editable Track',
  artist: '未知艺术家',
  album: '未知专辑',
  language: null,
  fileName: 'Editable Track.flac',
  duration: 60,
  fileSize: 100,
  modifiedAt: 1,
  hasLyrics: true,
  hasArtwork: false,
  playbackUrl: 'lyralume-media://track/888888888888888888888888',
};

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
  window.lyralume = api;
  useAppStore.setState({
    tracks: [item],
    roots: [],
    queueIds: [item.id],
    currentTrackId: null,
    isPlaying: false,
    localLyricsTasks: {},
    libraryMessage: null,
  });
});

afterEach(() => cleanup());

describe('TrackList metadata editing', () => {
  it('chooses and publishes a new MP3 cover from the track action', async () => {
    const mp3 = { ...item, fileName: 'Editable Track.mp3' };
    const updated = {
      ...mp3,
      hasArtwork: true,
      artworkUrl: `${mp3.playbackUrl.replace('/track/', '/artwork/')}?v=2`,
    };
    api.library.chooseArtwork.mockResolvedValue({ tracks: [updated], roots: [] });
    render(<TrackList tracks={[mp3]} />);

    fireEvent.click(screen.getByRole('button', { name: '添加 Editable Track 的 MP3 封面' }));

    await waitFor(() => expect(api.library.chooseArtwork).toHaveBeenCalledWith(mp3.id));
    expect(useAppStore.getState().tracks[0]).toMatchObject({ hasArtwork: true });
    expect(useAppStore.getState().libraryMessage).toContain('完成回读验证');
  });

  it('shows the fixed language tags and saves a selection', async () => {
    api.library.updateMetadata.mockResolvedValue({
      tracks: [{ ...item, language: 'zho' }],
      roots: [],
    });
    render(<TrackList tracks={[item]} />);

    const language = screen.getByRole('combobox', { name: '设置 Editable Track 的语种' });
    expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual([
      '未设置', '中文', '英文', '日文', '纯音乐', '韩语',
    ]);
    fireEvent.change(language, { target: { value: 'zho' } });

    await waitFor(() => expect(api.library.updateMetadata).toHaveBeenCalledWith(item.id, {
      language: 'zho',
    }));
  });

  it('enters edit mode on double click and saves artist and album', async () => {
    const updated = {
      ...item,
      title: 'New Title',
      artist: 'New Artist',
      album: 'New Album',
    };
    api.library.updateMetadata.mockResolvedValue({ tracks: [updated], roots: [] });
    render(<TrackList tracks={[item]} />);

    fireEvent.doubleClick(screen.getByRole('button', { name: /播放 Editable Track.*双击编辑歌曲信息/ }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Editable Track 的歌曲名' }), {
      target: { value: 'New Title' },
    });
    fireEvent.change(screen.getByRole('textbox', { name: 'Editable Track 的艺术家' }), {
      target: { value: 'New Artist' },
    });
    fireEvent.change(screen.getByRole('textbox', { name: 'Editable Track 的专辑' }), {
      target: { value: 'New Album' },
    });
    fireEvent.click(screen.getByRole('button', { name: '保存到文件' }));

    await waitFor(() => expect(api.library.updateMetadata).toHaveBeenCalledWith(item.id, {
      title: 'New Title',
      artist: 'New Artist',
      album: 'New Album',
    }));
    expect(screen.queryByRole('textbox', { name: 'Editable Track 的艺术家' })).not.toBeInTheDocument();
  });

  it('rewrites unchanged metadata when Enter is pressed', async () => {
    const taggedItem = {
      ...item,
      artist: 'Current Artist',
      album: 'Current Album',
    };
    api.library.updateMetadata.mockResolvedValue({ tracks: [taggedItem], roots: [] });
    const { container } = render(<TrackList tracks={[taggedItem]} />);

    fireEvent.click(container.querySelector('.track-row__edit') as HTMLElement);
    const saveButton = container.querySelector('.track-row__save') as HTMLButtonElement;
    expect(saveButton).toBeEnabled();
    fireEvent.keyDown(screen.getAllByRole('textbox')[0], { key: 'Enter' });

    await waitFor(() => expect(api.library.updateMetadata).toHaveBeenCalledWith(item.id, {
      title: 'Editable Track',
      artist: 'Current Artist',
      album: 'Current Album',
    }));
  });

  it('sends an empty field so its existing tag is deleted', async () => {
    const taggedItem = {
      ...item,
      artist: 'Current Artist',
      album: 'Current Album',
    };
    api.library.updateMetadata.mockResolvedValue({
      tracks: [{ ...taggedItem, album: '未知专辑' }],
      roots: [],
    });
    const { container } = render(<TrackList tracks={[taggedItem]} />);

    fireEvent.click(container.querySelector('.track-row__edit') as HTMLElement);
    fireEvent.change(screen.getByRole('textbox', { name: 'Editable Track 的专辑' }), {
      target: { value: '' },
    });
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Editable Track 的专辑' }), {
      key: 'Enter',
    });

    await waitFor(() => expect(api.library.updateMetadata).toHaveBeenCalledWith(item.id, {
      title: 'Editable Track',
      artist: 'Current Artist',
      album: '',
    }));
  });
});
