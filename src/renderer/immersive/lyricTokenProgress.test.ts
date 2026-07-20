import { describe, expect, it } from 'vitest';
import { lyricTokenProgressAtTime } from './lyricTokenProgress';

describe('lyricTokenProgressAtTime', () => {
  const token = { startTime: 2, endTime: 3 };

  it('distinguishes future, current and completed tokens', () => {
    expect(lyricTokenProgressAtTime(token, 1.9)).toEqual({ progress: 0, state: 'future' });
    expect(lyricTokenProgressAtTime(token, 2.25)).toEqual({ progress: 0.25, state: 'current' });
    expect(lyricTokenProgressAtTime(token, 3)).toEqual({ progress: 1, state: 'past' });
  });
});
