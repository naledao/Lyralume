import { describe, expect, it } from 'vitest';
import { crossedBeat, currentVisualSection } from './visualTimeline';

describe('visual timeline', () => {
  it('detects a crossed beat without firing after a seek', () => {
    expect(crossedBeat([500, 1_000], 470, 510)).toBe(true);
    expect(crossedBeat([500, 1_000], 510, 530)).toBe(false);
    expect(crossedBeat([500, 1_000], 100, 900)).toBe(false);
    expect(crossedBeat([500, 1_000], 900, 200)).toBe(false);
  });

  it('finds the active section', () => {
    const sections = [
      { id: 'a', startMs: 0, endMs: 1_000, axes: { drive: 0, pulse: 0, brightness: 0, texture: 0, tonality: 0, dynamics: 0, space: 0, complexity: 0 } },
      { id: 'b', startMs: 1_000, endMs: 2_000, axes: { drive: 1, pulse: 1, brightness: 1, texture: 1, tonality: 1, dynamics: 1, space: 1, complexity: 1 } },
    ];
    expect(currentVisualSection(sections, 1_500)?.id).toBe('b');
  });
});
