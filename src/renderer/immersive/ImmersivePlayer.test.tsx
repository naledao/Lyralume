import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Track } from '../../shared/contracts';
import { useAppStore } from '../store/useAppStore';
import { ImmersivePlayer } from './ImmersivePlayer';

vi.mock('../visuals/AudioVisualizer', () => ({
  AudioVisualizer: () => <div data-testid="immersive-visual" />,
}));

vi.mock('./ImmersiveLyrics', () => ({
  ImmersiveLyrics: () => <div data-testid="immersive-lyrics" />,
}));

function makeTrack(language: Track['language']): Track {
  return {
    id: '999999999999999999999999',
    title: 'Samurai',
    artist: 'Deaf Kev',
    album: 'Samurai',
    language,
    fileName: 'Samurai.mp3',
    duration: 340,
    fileSize: 1_024,
    modifiedAt: 1,
    hasLyrics: false,
    hasArtwork: false,
    playbackUrl: 'lyralume-media://track/999999999999999999999999',
  };
}

function setCurrentTrack(language: Track['language']): void {
  const track = makeTrack(language);
  useAppStore.setState({
    tracks: [track],
    currentTrackId: track.id,
    queueIds: [track.id],
    isPlaying: false,
    currentTime: 11,
    duration: track.duration,
    volume: 0.78,
  });
}

beforeEach(() => {
  setCurrentTrack(null);
});

afterEach(() => cleanup());

describe('ImmersivePlayer layout', () => {
  it('uses the whole screen for visuals when the track is marked as instrumental', () => {
    setCurrentTrack('zxx');
    const { container } = render(<ImmersivePlayer active onExit={vi.fn()} />);

    expect(container.querySelector('.immersive-player__layout')).toHaveAttribute(
      'data-visual-only',
      'true',
    );
    expect(screen.getByTestId('immersive-visual')).toBeVisible();
    expect(screen.queryByTestId('immersive-lyrics')).not.toBeInTheDocument();
    expect(screen.getAllByText('Samurai')).toHaveLength(1);
  });

  it('keeps the lyric column for a non-instrumental track without an LRC file', () => {
    setCurrentTrack('eng');
    const { container } = render(<ImmersivePlayer active onExit={vi.fn()} />);

    expect(container.querySelector('.immersive-player__layout')).toHaveAttribute(
      'data-visual-only',
      'false',
    );
    expect(screen.getByTestId('immersive-lyrics')).toBeVisible();
  });
});
