import { useEffect, useRef } from 'react';
import type { PlaybackCheckpointReason, Track } from '../../shared/contracts';
import { currentTrackFromState, useAppStore } from '../store/useAppStore';
import { audioEngine } from './AudioEngine';
import {
  checkpointFromSnapshot,
  persistPlaybackCheckpoint,
  persistPlaybackCheckpointInBackground,
} from './playbackCheckpoints';

const PERIODIC_CHECKPOINT_INTERVAL_MS = 5_000;

function persistTrackSnapshot(
  track: Track,
  reason: PlaybackCheckpointReason,
  completed = false,
): ReturnType<typeof persistPlaybackCheckpoint> {
  const engineSnapshot = audioEngine.getPlaybackSnapshot();
  const state = useAppStore.getState();
  const snapshot = engineSnapshot.hasSource
    ? engineSnapshot
    : {
        ...engineSnapshot,
        currentTime: state.currentTrackId === track.id ? state.currentTime : 0,
        duration: state.currentTrackId === track.id ? state.duration : track.duration,
      };
  return persistPlaybackCheckpoint(checkpointFromSnapshot(
    track.id,
    snapshot,
    reason,
    { completed, fallbackDuration: track.duration },
  ));
}

export function AudioController(): null {
  const currentTrackId = useAppStore((state) => state.currentTrackId);
  const isPlaying = useAppStore((state) => state.isPlaying);
  const volume = useAppStore((state) => state.volume);
  const loadedTrackId = useRef<string | null>(null);
  const lastPeriodicCheckpointAt = useRef(0);

  useEffect(() => {
    const currentLoadedTrack = (): Track | undefined => {
      const trackId = loadedTrackId.current;
      if (!trackId) return undefined;
      return useAppStore.getState().tracks.find((track) => track.id === trackId);
    };
    const offTime = audioEngine.on('time', ({ currentTime, duration }) => {
      const state = useAppStore.getState();
      if (!loadedTrackId.current || state.currentTrackId !== loadedTrackId.current) return;
      state.setPlaybackTime(currentTime, duration);
      const now = Date.now();
      if (state.isPlaying && now - lastPeriodicCheckpointAt.current >= PERIODIC_CHECKPOINT_INTERVAL_MS) {
        const track = currentLoadedTrack();
        if (track) {
          lastPeriodicCheckpointAt.current = now;
          persistPlaybackCheckpointInBackground(checkpointFromSnapshot(
            track.id,
            audioEngine.getPlaybackSnapshot(),
            'periodic',
            { fallbackDuration: track.duration },
          ));
        }
      }
    });
    const offDuration = audioEngine.on('duration', (duration) => {
      const state = useAppStore.getState();
      if (loadedTrackId.current && state.currentTrackId === loadedTrackId.current) {
        state.setDuration(duration);
      }
    });
    const offEnded = audioEngine.on('ended', () => {
      const track = currentLoadedTrack();
      if (!track) return;
      const endedTrackId = track.id;
      void persistTrackSnapshot(track, 'ended', true).catch((error) => {
        console.warn('Completed playback position could not be saved', error);
      });
      const state = useAppStore.getState();
      state.handleTrackEnded();
      if (useAppStore.getState().currentTrackId === endedTrackId) {
        audioEngine.seek(0);
        if (state.playbackMode === 'repeat-one') void audioEngine.play();
      }
    });
    const offSeeked = audioEngine.on('seeked', () => {
      const track = currentLoadedTrack();
      if (!track || useAppStore.getState().currentTrackId !== track.id) return;
      void persistTrackSnapshot(track, 'seek').catch((error) => {
        console.warn('Seek position could not be saved', error);
      });
    });
    const offError = audioEngine.on('error', (message) => {
      const state = useAppStore.getState();
      if (loadedTrackId.current && state.currentTrackId !== loadedTrackId.current) return;
      state.setPlaying(false);
      state.setPlaybackError(message);
    });
    const onVisibilityChange = (): void => {
      if (!document.hidden) return;
      const track = currentLoadedTrack();
      if (track) persistPlaybackCheckpointInBackground(checkpointFromSnapshot(
        track.id,
        audioEngine.getPlaybackSnapshot(),
        'app-hidden',
        { fallbackDuration: track.duration },
      ));
    };
    const offFlush = window.lyralume.app.onPlaybackFlushRequested((requestId) => {
      const track = currentLoadedTrack();
      const flush = track
        ? persistTrackSnapshot(track, 'app-close')
        : Promise.resolve();
      void flush.finally(() => window.lyralume.app.completePlaybackFlush(requestId));
    });
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      offTime();
      offDuration();
      offEnded();
      offSeeked();
      offError();
      offFlush();
      document.removeEventListener('visibilitychange', onVisibilityChange);
      void audioEngine.dispose();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const state = useAppStore.getState();
    const nextTrack = currentTrackFromState(state);
    const previousTrackId = loadedTrackId.current;
    const previousTrack = previousTrackId
      ? state.tracks.find((track) => track.id === previousTrackId)
      : undefined;
    const previousSnapshot = audioEngine.getPlaybackSnapshot();
    loadedTrackId.current = null;
    lastPeriodicCheckpointAt.current = 0;
    audioEngine.pause();

    void (async () => {
      if (previousTrack && previousTrack.id !== nextTrack?.id && previousSnapshot.hasSource) {
        await persistPlaybackCheckpoint(checkpointFromSnapshot(
          previousTrack.id,
          previousSnapshot,
          'track-switch',
          { fallbackDuration: previousTrack.duration },
        )).catch((error) => {
          console.warn('Track switch position could not be saved', error);
        });
      }
      if (cancelled) return;
      if (!nextTrack) {
        audioEngine.releaseSource();
        return;
      }
      const startTime = useAppStore.getState().currentTime;
      loadedTrackId.current = nextTrack.id;
      await audioEngine.load(nextTrack.playbackUrl, false, startTime);
      if (cancelled || useAppStore.getState().currentTrackId !== nextTrack.id) return;
      persistPlaybackCheckpointInBackground(checkpointFromSnapshot(
        nextTrack.id,
        audioEngine.getPlaybackSnapshot(),
        'track-selected',
        { fallbackDuration: nextTrack.duration },
      ));
      if (useAppStore.getState().isPlaying) await audioEngine.play();
    })();

    return () => {
      cancelled = true;
    };
  }, [currentTrackId]);

  useEffect(() => {
    if (!currentTrackId || loadedTrackId.current !== currentTrackId) return;
    if (isPlaying) {
      void audioEngine.play();
      return;
    }
    audioEngine.pause();
    const track = currentTrackFromState(useAppStore.getState());
    if (track) persistPlaybackCheckpointInBackground(checkpointFromSnapshot(
      track.id,
      audioEngine.getPlaybackSnapshot(),
      'pause',
      { fallbackDuration: track.duration },
    ));
  }, [currentTrackId, isPlaying]);

  useEffect(() => audioEngine.setVolume(volume), [volume]);
  return null;
}
