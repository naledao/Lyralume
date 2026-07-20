import { currentTrackFromState, useAppStore } from '../store/useAppStore';
import { audioEngine } from './AudioEngine';

export function seekPlayback(time: number): number {
  const state = useAppStore.getState();
  const track = currentTrackFromState(state);
  const duration = Math.max(state.duration || track?.duration || 0, 0);
  const normalized = Number.isFinite(time) ? time : 0;
  const target = Math.min(Math.max(0, normalized), duration || Math.max(0, normalized));
  state.setPlaybackTime(target, duration);
  audioEngine.seek(target);
  return target;
}
