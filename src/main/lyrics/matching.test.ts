// @vitest-environment node

import { describe, expect, it } from 'vitest';
import type { LrclibRecord, LyricsSearchTrack } from './lrclib';
import { rankLyricsCandidates, textSimilarity } from './matching';

const track: LyricsSearchTrack = {
  title: 'To the End',
  artist: 'Blur',
  album: 'The Best of Blur',
  duration: 232,
};

function record(overrides: Partial<LrclibRecord>): LrclibRecord {
  return {
    id: 1,
    trackName: 'To the End',
    artistName: 'Blur',
    albumName: 'The Best of Blur',
    duration: 232.4,
    instrumental: false,
    plainLyrics: null,
    syncedLyrics: '[00:01.00]First line\n[00:02.00]Second line',
    ...overrides,
  };
}

describe('online lyrics matching', () => {
  it('normalizes punctuation and ranks the closest duration/version first', () => {
    expect(textSimilarity('Ａ Song!', 'a song')).toBe(1);
    const ranked = rankLyricsCandidates(track, [
      record({ id: 2, trackName: 'To the End (Instrumental)', duration: 304 }),
      record({ id: 1 }),
    ]);
    expect(ranked[0]).toMatchObject({ id: 1, confidence: 'high' });
    expect(ranked[0].score).toBeGreaterThan(ranked[1].score);
    expect(ranked[0].preview).toContain('First line');
  });

  it('does not auto-recommend ambiguous near-equal candidates', () => {
    const ranked = rankLyricsCandidates(track, [
      record({ id: 1, albumName: 'The Best of Blur', duration: 232.4 }),
      record({ id: 2, albumName: 'Best of Blur', duration: 232.8 }),
    ]);
    expect(ranked).toHaveLength(2);
    expect(ranked.every((candidate) => !candidate.recommended)).toBe(true);
  });

  it('drops instrumental and unsynchronized records', () => {
    const ranked = rankLyricsCandidates(track, [
      record({ id: 1, syncedLyrics: null }),
      record({ id: 2, instrumental: true }),
    ]);
    expect(ranked).toEqual([]);
  });
});
