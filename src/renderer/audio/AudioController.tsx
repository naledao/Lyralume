import { useEffect } from 'react';
import { currentTrackFromState, useAppStore } from '../store/useAppStore';
import { audioEngine } from './AudioEngine';

export function AudioController(): null {
  const currentTrackId = useAppStore((state) => state.currentTrackId);
  const isPlaying = useAppStore((state) => state.isPlaying);
  const volume = useAppStore((state) => state.volume);

  useEffect(() => {
    const offTime = audioEngine.on('time', ({ currentTime, duration }) => {
      useAppStore.getState().setPlaybackTime(currentTime, duration);
    });
    const offDuration = audioEngine.on('duration', (duration) => {
      useAppStore.getState().setDuration(duration);
    });
    const offEnded = audioEngine.on('ended', () => useAppStore.getState().nextTrack());
    const offError = audioEngine.on('error', (message) => {
      useAppStore.getState().setPlaying(false);
      useAppStore.getState().setPlaybackError(message);
    });
    return () => {
      offTime();
      offDuration();
      offEnded();
      offError();
      void audioEngine.dispose();
    };
  }, []);

  useEffect(() => {
    const track = currentTrackFromState(useAppStore.getState());
    if (!track) {
      audioEngine.pause();
      return;
    }
    void audioEngine.load(track.playbackUrl, useAppStore.getState().isPlaying);
  }, [currentTrackId]);

  useEffect(() => {
    if (!currentTrackId) return;
    if (isPlaying) void audioEngine.play();
    else audioEngine.pause();
  }, [currentTrackId, isPlaying]);

  useEffect(() => audioEngine.setVolume(volume), [volume]);
  return null;
}
