import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Track } from '../../shared/contracts';
import { audioEngine } from '../audio/AudioEngine';
import { useAppStore } from '../store/useAppStore';
import { PlayerControls } from './PlayerControls';

const item: Track = {
  id: '111111111111111111111111',
  title: 'Mode Test',
  artist: 'Artist',
  album: 'Album',
  language: null,
  fileName: 'Mode Test.mp3',
  duration: 120,
  fileSize: 1_024,
  modifiedAt: 1,
  hasLyrics: false,
  hasArtwork: false,
  playbackUrl: 'lyralume-media://track/111111111111111111111111',
};

beforeEach(() => {
  useAppStore.setState({
    tracks: [item],
    queueIds: [item.id],
    currentTrackId: item.id,
    isPlaying: false,
    currentTime: 0,
    duration: item.duration,
    volume: 0.78,
    playbackError: null,
    playbackMode: 'sequence',
    shuffleQueueIds: [],
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('PlayerControls playback mode', () => {
  it('previews a dragged position and commits it when released', () => {
    const seek = vi.spyOn(audioEngine, 'seek').mockImplementation(() => undefined);
    render(<PlayerControls />);
    const timeline = screen.getByRole('slider', { name: '播放进度' });

    fireEvent.pointerDown(timeline);
    fireEvent.change(timeline, { target: { value: '45' } });
    expect(timeline).toHaveValue('45');
    expect(useAppStore.getState().currentTime).toBe(0);

    fireEvent.pointerUp(timeline);
    expect(useAppStore.getState().currentTime).toBe(45);
    expect(seek).toHaveBeenCalledWith(45);
    seek.mockRestore();
  });

  it('shows and cycles all three playback modes', () => {
    render(<PlayerControls />);

    fireEvent.click(screen.getByRole('button', { name: '播放模式：顺序播放，点击切换' }));
    expect(screen.getByRole('button', { name: '播放模式：列表随机，点击切换' })).toBeInTheDocument();
    expect(useAppStore.getState().playbackMode).toBe('shuffle');

    fireEvent.click(screen.getByRole('button', { name: '播放模式：列表随机，点击切换' }));
    expect(screen.getByRole('button', { name: '播放模式：单曲循环，点击切换' })).toBeInTheDocument();
    expect(useAppStore.getState().playbackMode).toBe('repeat-one');

    fireEvent.click(screen.getByRole('button', { name: '播放模式：单曲循环，点击切换' }));
    expect(screen.getByRole('button', { name: '播放模式：顺序播放，点击切换' })).toBeInTheDocument();
    expect(useAppStore.getState().playbackMode).toBe('sequence');
  });
});
