import type {
  PlaybackCheckpoint,
  PlaybackCheckpointReason,
  PlaybackProgress,
} from '../../shared/contracts';
import { useAppStore } from '../store/useAppStore';
import { audioEngine, type AudioPlaybackSnapshot } from './AudioEngine';

let checkpointQueue: Promise<unknown> = Promise.resolve();

function secondsToMilliseconds(seconds: number): number {
  if (!Number.isFinite(seconds)) return 0;
  return Math.min(2_147_483_647, Math.max(0, Math.round(seconds * 1_000)));
}

export function checkpointFromSnapshot(
  trackId: string,
  snapshot: AudioPlaybackSnapshot,
  reason: PlaybackCheckpointReason,
  options: { completed?: boolean; fallbackDuration?: number } = {},
): PlaybackCheckpoint {
  const duration = snapshot.duration > 0
    ? snapshot.duration
    : options.fallbackDuration ?? 0;
  return {
    trackId,
    positionMs: options.completed ? 0 : secondsToMilliseconds(snapshot.currentTime),
    durationMs: secondsToMilliseconds(duration),
    completed: options.completed === true,
    reason,
  };
}

export function persistPlaybackCheckpoint(
  checkpoint: PlaybackCheckpoint,
): Promise<PlaybackProgress> {
  const next = checkpointQueue.then(async () => {
    const progress = await window.lyralume.playback.saveCheckpoint(checkpoint);
    useAppStore.getState().applyPlaybackProgress(progress);
    return progress;
  });
  checkpointQueue = next.catch(() => undefined);
  return next;
}

export function persistPlaybackCheckpointInBackground(
  checkpoint: PlaybackCheckpoint,
): void {
  void persistPlaybackCheckpoint(checkpoint).catch((error) => {
    console.warn('Playback checkpoint could not be saved', error);
  });
}

export function persistCurrentPlaybackCheckpoint(
  reason: PlaybackCheckpointReason = 'file-operation',
): Promise<PlaybackProgress | null> {
  const state = useAppStore.getState();
  const track = state.currentTrackId
    ? state.tracks.find((item) => item.id === state.currentTrackId)
    : undefined;
  if (!track) return Promise.resolve(null);
  const engineSnapshot = audioEngine.getPlaybackSnapshot();
  const snapshot = engineSnapshot.hasSource
    ? engineSnapshot
    : {
        ...engineSnapshot,
        currentTime: state.currentTime,
        duration: state.duration || track.duration,
      };
  return persistPlaybackCheckpoint(checkpointFromSnapshot(
    track.id,
    snapshot,
    reason,
    { fallbackDuration: track.duration },
  ));
}
