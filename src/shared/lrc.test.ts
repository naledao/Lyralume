import { describe, expect, it } from 'vitest';
import { findActiveLyricIndex, parseLrc } from './lrc';

describe('parseLrc', () => {
  it('parses metadata, multiple timestamps and millisecond precision', () => {
    const parsed = parseLrc(`
      [ar:Example Artist]
      [offset:250]
      [00:01.20][00:03.450]First line
      [00:05]Second line
    `);

    expect(parsed.metadata.ar).toBe('Example Artist');
    expect(parsed.sourceOffsetMs).toBe(250);
    expect(parsed.lines.map((line) => [line.time, line.text])).toEqual([
      [1.2, 'First line'],
      [3.45, 'First line'],
      [5, 'Second line'],
    ]);
  });

  it('ignores malformed timestamps without discarding valid lines', () => {
    const parsed = parseLrc('[00:61.00]bad\nplain text\n[01:02.5]good');
    expect(parsed.lines).toHaveLength(1);
    expect(parsed.lines[0]).toMatchObject({ time: 62.5, text: 'good' });
  });
});

describe('findActiveLyricIndex', () => {
  const lines = parseLrc('[00:01]one\n[00:02]two\n[00:04]three').lines;

  it('finds the latest line at or before playback time', () => {
    expect(findActiveLyricIndex(lines, 0.9)).toBe(-1);
    expect(findActiveLyricIndex(lines, 2.7)).toBe(1);
    expect(findActiveLyricIndex(lines, 9)).toBe(2);
  });

  it('applies a positive display offset later on the timeline', () => {
    expect(findActiveLyricIndex(lines, 2.2, 500)).toBe(0);
    expect(findActiveLyricIndex(lines, 2.5, 500)).toBe(1);
  });
});
