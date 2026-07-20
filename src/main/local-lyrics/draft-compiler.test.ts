// @vitest-environment node

import { describe, expect, it } from 'vitest';
import { compileAlignmentToDraft, DraftValidationError, draftToLrc, validateDraftUpdate } from './draft-compiler';

describe('local lyrics draft compiler', () => {
  it('preserves aligned text and marks low-confidence or missing timing', () => {
    const lines = compileAlignmentToDraft({
      segments: [{
        text: '你好世界。 again',
        start: 1,
        end: 4,
        words: [
          { word: '你好', start: 1, end: 1.5, score: 0.95 },
          { word: '世界。', start: 1.6, end: 2.2, score: 0.9 },
          { word: 'again', score: 0.4 },
        ],
      }],
    });

    expect(lines[0]).toMatchObject({
      text: '你好世界。',
      startTime: 1,
      endTime: 2.2,
      flags: [],
      tokens: [
        { text: '你好', startTime: 1, endTime: 1.5 },
        { text: '世界。', startTime: 1.6, endTime: 2.2 },
      ],
    });
    expect(lines[1]).toMatchObject({
      text: 'again',
      flags: ['missing_timing', 'low_confidence'],
    });
  });

  it('builds UTF-8 LRC with an overall offset and optional draft notice', () => {
    const raw = draftToLrc({
      offsetMs: 500,
      lines: [{
        id: 'line-1',
        startTime: 1,
        endTime: 2,
        text: '着迷于你眼睛',
        confidence: 0.9,
        flags: [],
      }],
    }, true);
    expect(raw).toBe('[by:Lyralume AI 草稿（未经确认）]\n[00:01.50]着迷于你眼睛\n');
  });

  it('rejects reordered lines and unsafe text control characters', () => {
    expect(() => validateDraftUpdate({
      offsetMs: 0,
      lines: [
        { id: 'a', startTime: 2, endTime: 3, text: 'A', confidence: 1, flags: [] },
        { id: 'b', startTime: 1, endTime: 2, text: 'B', confidence: 1, flags: [] },
      ],
    })).toThrow(DraftValidationError);
    expect(validateDraftUpdate({
      offsetMs: 0,
      lines: [{ id: 'a', startTime: 1, endTime: 2, text: 'A\nB\0', confidence: 1, flags: [] }],
    }).lines[0].text).toBe('A B');
  });

  it('keeps matching fine timing but drops it after the lyric text changes', () => {
    const line = {
      id: 'line-1',
      startTime: 1,
      endTime: 2,
      text: 'Hello world',
      confidence: 0.9,
      flags: [] as const,
      tokens: [
        { text: 'Hello ', startTime: 1, endTime: 1.4 },
        { text: 'world', startTime: 1.4, endTime: 2 },
      ],
    };
    const preserved = validateDraftUpdate({ lines: [{ ...line, flags: [] }], offsetMs: 0 });
    const edited = validateDraftUpdate({
      lines: [{ ...line, text: 'Hello there', flags: [] }],
      offsetMs: 0,
    });

    expect(preserved.lines[0].tokens).toHaveLength(2);
    expect(edited.lines[0].tokens).toBeUndefined();
  });
});
