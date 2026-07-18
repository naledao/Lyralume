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
    rescan: vi.fn(),
    onChanged: vi.fn(() => () => undefined),
    onScanProgress: vi.fn(() => () => undefined),
  },
  lyrics: {
    load: vi.fn(),
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
    lyricsError: null,
  });
});

describe('player store', () => {
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
    });
    useAppStore.getState().applySnapshot({ tracks: [item], roots: [] });
    useAppStore.getState().selectTrack(item.id);
    await vi.waitFor(() => expect(useAppStore.getState().lyricsStatus).toBe('loaded'));
    expect(useAppStore.getState().lyricLines[0].text).toBe('Hello');
    expect(useAppStore.getState().lyricOffsetMs).toBe(100);
  });
});
