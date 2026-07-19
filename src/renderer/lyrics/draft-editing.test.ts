import { describe, expect, it } from 'vitest';
import type { LocalLyricsDraftLine } from '../../shared/contracts';
import { mergeDraftLineWithPrevious, splitDraftLine, updateDraftLineTime } from './draft-editing';

const lines: LocalLyricsDraftLine[] = [
  { id: 'one', startTime: 1, endTime: 3, text: 'first line', confidence: 0.9, flags: [] },
  { id: 'two', startTime: 3, endTime: 5, text: 'second line', confidence: 0.5, flags: ['low_confidence'] },
];

describe('draft editing operations', () => {
  it('splits text and its time range without losing content', () => {
    const result = splitDraftLine(lines, 'one');
    expect(result).toHaveLength(3);
    expect(`${result[0].text} ${result[1].text}`).toBe('first line');
    expect(result[0].endTime).toBe(result[1].startTime);
  });

  it('merges with the previous line and retains warning flags', () => {
    const result = mergeDraftLineWithPrevious(lines, 'two');
    expect(result).toEqual([expect.objectContaining({
      text: 'first line second line',
      startTime: 1,
      endTime: 5,
      flags: ['low_confidence'],
    })]);
  });

  it('clears missing timing after a user assigns a start time', () => {
    const result = updateDraftLineTime({ ...lines[0], flags: ['missing_timing'] }, 2.5);
    expect(result).toMatchObject({ startTime: 2.5, endTime: 4.5, flags: [] });
  });
});
