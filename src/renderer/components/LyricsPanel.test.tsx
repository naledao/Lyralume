import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { OnlineLyricsCandidate, Track } from '../../shared/contracts';
import { CandidateCard } from './LyricsPanel';

const track: Track = {
  id: '999999999999999999999999',
  title: '水星记（待补全）',
  artist: '未知艺术家',
  album: '未知专辑',
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
