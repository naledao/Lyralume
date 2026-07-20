import { describe, expect, it } from 'vitest';
import {
  createFallbackProfile,
  createSeededRandom,
  createVisualDNA,
  hashVisualSeed,
} from './visual-analysis';

describe('visual DNA', () => {
  it('is deterministic for the same song identity', () => {
    const profile = createFallbackProfile();
    expect(createVisualDNA(profile, 'track-a')).toEqual(createVisualDNA(profile, 'track-a'));
    expect(createVisualDNA(profile, 'track-a')).not.toEqual(createVisualDNA(profile, 'track-b'));
  });

  it('produces a repeatable seeded random sequence', () => {
    const seed = hashVisualSeed('song');
    const first = createSeededRandom(seed);
    const second = createSeededRandom(seed);
    expect([first(), first(), first()]).toEqual([second(), second(), second()]);
  });
});
