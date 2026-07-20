import type { TimedLyricToken } from '../../shared/lrc';

export type LyricTokenState = 'future' | 'current' | 'past';

export interface LyricTokenProgress {
  progress: number;
  state: LyricTokenState;
}

export function lyricTokenProgressAtTime(
  token: Pick<TimedLyricToken, 'startTime' | 'endTime'>,
  currentTime: number,
): LyricTokenProgress {
  if (currentTime < token.startTime) return { progress: 0, state: 'future' };
  if (currentTime >= token.endTime) return { progress: 1, state: 'past' };
  const duration = Math.max(0.04, token.endTime - token.startTime);
  return {
    progress: Math.min(1, Math.max(0, (currentTime - token.startTime) / duration)),
    state: 'current',
  };
}
