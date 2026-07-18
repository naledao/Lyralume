import type { Track } from '../../shared/contracts';
import { useAppStore } from '../store/useAppStore';
import { audioEngine } from './AudioEngine';

let sourceOperationQueue: Promise<unknown> = Promise.resolve();

/**
 * Release the current media handle while an operation modifies its source file,
 * then restore the previous position and playback state. Operations are also
 * serialized so a second tag write cannot reopen the file during the first one.
 */
export async function withReleasedTrackSource<T>(
  track: Track,
  operation: () => Promise<T>,
): Promise<T> {
  const next = sourceOperationQueue.then(async () => {
    const state = useAppStore.getState();
    if (state.currentTrackId !== track.id) return operation();

    const wasPlaying = state.isPlaying;
    const savedPosition = state.currentTime;
    state.setPlaying(false);
    audioEngine.releaseSource();
    try {
      return await operation();
    } finally {
      if (useAppStore.getState().currentTrackId === track.id) {
        await audioEngine.restoreSource(track.playbackUrl, savedPosition);
        useAppStore.getState().setPlaybackTime(savedPosition);
        useAppStore.getState().setPlaying(wasPlaying);
      }
    }
  });
  sourceOperationQueue = next.catch(() => undefined);
  return next;
}
