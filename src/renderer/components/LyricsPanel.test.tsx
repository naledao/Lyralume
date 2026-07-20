import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LocalLyricsTask, OnlineLyricsCandidate, Track } from '../../shared/contracts';
import { audioEngine } from '../audio/AudioEngine';
import { useAppStore } from '../store/useAppStore';
import { CandidateCard, LyricsPanel } from './LyricsPanel';

Element.prototype.scrollIntoView = vi.fn();

afterEach(() => {
  cleanup();
});

const track: Track = {
  id: '999999999999999999999999',
  title: '水星记（待补全）',
  artist: '未知艺术家',
  album: '未知专辑',
  language: null,
  fileName: '水星记.mp3',
  duration: 325,
  fileSize: 100,
  modifiedAt: 1,
  hasLyrics: false,
  hasArtwork: false,
  playbackUrl: 'lyralume-media://track/999999999999999999999999',
};

const candidate: OnlineLyricsCandidate = {
  id: 42,
  trackName: '水星记',
  artistName: '郭顶',
  albumName: '飞行器的执行周期',
  duration: 325,
  instrumental: false,
  syncedLyrics: '[00:01.00]歌词',
  preview: '歌词',
  score: 92,
  durationDelta: 0,
  confidence: 'high',
  recommended: true,
};

const existingLocalTask: LocalLyricsTask = {
  id: '62fa754e-65f0-4148-b68b-22278102ef18',
  trackId: track.id,
  status: 'review',
  stage: 'draft',
  progress: 1,
  message: '请校对',
  draftLines: [],
  draftOffsetMs: 0,
  lowConfidenceCount: 0,
  lrcSaveStatus: 'not_started',
  tagWriteStatus: 'not_started',
  createdAt: 1,
  updatedAt: 1,
};

describe('CandidateCard metadata actions', () => {
  it('keeps lyrics, title, artist and album as four independent direct-write actions', async () => {
    const onWriteLyrics = vi.fn();
    const onFillTitle = vi.fn(async () => true);
    const onFillArtist = vi.fn(async () => true);
    const onFillAlbum = vi.fn(async () => true);
    render(
      <CandidateCard
        track={track}
        candidate={candidate}
        busy={false}
        onWriteLyrics={onWriteLyrics}
        onFillTitle={onFillTitle}
        onFillArtist={onFillArtist}
        onFillAlbum={onFillAlbum}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '写入歌词' }));
    fireEvent.click(screen.getByRole('button', { name: '补全歌曲名' }));
    await waitFor(() => expect(onFillTitle).toHaveBeenCalledWith(candidate));
    fireEvent.click(screen.getByRole('button', { name: '补全艺术家' }));
    await waitFor(() => expect(onFillArtist).toHaveBeenCalledWith(candidate));
    fireEvent.click(screen.getByRole('button', { name: '补全专辑' }));
    await waitFor(() => expect(onFillAlbum).toHaveBeenCalledWith(candidate));

    expect(onWriteLyrics).toHaveBeenCalledWith(candidate.id);
    expect(onFillTitle).toHaveBeenCalledTimes(1);
    expect(onFillArtist).toHaveBeenCalledTimes(1);
    expect(onFillAlbum).toHaveBeenCalledTimes(1);
  });
});

describe('LyricsPanel Codex progress', () => {
  it('seeks playback immediately when a synchronized lyric is clicked', () => {
    const seek = vi.spyOn(audioEngine, 'seek').mockImplementation(() => undefined);
    useAppStore.setState({
      tracks: [{ ...track, hasLyrics: true }],
      currentTrackId: track.id,
      currentTime: 0,
      duration: track.duration,
      lyricsStatus: 'loaded',
      lyricLines: [{ id: 'seek-line', time: 12, text: '点击跳转歌词' }],
      lyricOffsetMs: 500,
      lyricsSource: 'lrc',
      lyricsRevision: 'f'.repeat(64),
      localLyricsProofreadProgress: {},
    });

    render(<LyricsPanel />);
    fireEvent.click(screen.getByRole('button', { name: '点击跳转歌词' }));

    expect(useAppStore.getState().currentTime).toBe(12.5);
    expect(seek).toHaveBeenCalledWith(12.5);
    seek.mockRestore();
  });

  it('keeps a visible local-generation entry when the current track already has a task', () => {
    useAppStore.setState({
      tracks: [{ ...track, hasLyrics: true }],
      currentTrackId: track.id,
      lyricsStatus: 'loaded',
      localLyricsTask: existingLocalTask,
      localLyricsTasks: { [track.id]: existingLocalTask },
      localLyricsProofreadProgress: {},
    });

    render(<LyricsPanel />);

    expect(screen.getByRole('button', { name: '本机生成' })).toBeVisible();
    expect(screen.queryByRole('button', { name: '查看本曲任务' })).not.toBeInTheDocument();
  });

  it('renders a selected track when no Codex workflow events have been recorded', () => {
    useAppStore.setState({
      tracks: [track],
      currentTrackId: track.id,
      lyricsStatus: 'missing',
      localLyricsProofreadProgress: {},
    });

    expect(() => render(<LyricsPanel />)).not.toThrow();
  });

  it('offers an explicit audio-tag write after previewing an offset', () => {
    useAppStore.setState({
      tracks: [{ ...track, hasLyrics: true }],
      currentTrackId: track.id,
      lyricsStatus: 'loaded',
      lyricLines: [{ id: '1', time: 2, text: '歌词' }],
      lyricOffsetMs: -2_000,
      lyricsSource: 'lrc',
      lyricsRevision: 'd'.repeat(64),
      lyricTimingWriteBusy: false,
      lyricTimingWriteError: null,
      lyricTimingWriteMessage: null,
      localLyricsProofreadProgress: {},
    });

    render(<LyricsPanel />);

    expect(screen.getByRole('button', { name: '应用并写入音频' })).toBeEnabled();
    expect(screen.getByText('-2.0s')).toBeVisible();
    expect(screen.getByText('调整后写入同步歌词标签')).toBeVisible();
  });

  it('renders same-timestamp bilingual rows as one active cue', () => {
    useAppStore.setState({
      tracks: [{ ...track, hasLyrics: true }],
      currentTrackId: track.id,
      currentTime: 2,
      lyricsStatus: 'loaded',
      lyricLines: [
        { id: 'zh', time: 2, text: '住在城东，每一天都忙着工作' },
        { id: 'en', time: 2, text: 'On the East-side of the city, she was working every day' },
      ],
      lyricOffsetMs: 0,
      lyricsSource: 'embedded',
      lyricsRevision: 'e'.repeat(64),
      localLyricsProofreadProgress: {},
    });

    render(<LyricsPanel />);

    const activeCue = screen.getByRole('button', {
      name: /On the East-side of the city, she was working every day.*住在城东，每一天都忙着工作/,
    });
    expect(activeCue).toHaveAttribute('data-active', 'true');
    expect(activeCue.querySelectorAll('.lyric-line__text')).toHaveLength(2);
    expect(activeCue.querySelector('.lyric-line__text--translation')).toHaveTextContent(
      '住在城东，每一天都忙着工作',
    );
  });
});
