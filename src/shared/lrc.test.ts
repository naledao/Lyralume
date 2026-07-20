import { describe, expect, it } from 'vitest';
import { findActiveLyricIndex, groupLyricLines, mergePreciseLyricTiming, parseLrc } from './lrc';

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

  it('parses enhanced LRC token timestamps without exposing timing tags as text', () => {
    const parsed = parseLrc('[00:01.00]<00:01.00>Hello <00:01.50>world\n[00:03.00]Next');

    expect(parsed.lines[0]).toMatchObject({
      text: 'Hello world',
      tokens: [
        { text: 'Hello ', startTime: 1, endTime: 1.5 },
        { text: 'world', startTime: 1.5, endTime: 3 },
      ],
    });
  });
});

describe('mergePreciseLyricTiming', () => {
  const timing = [{
    time: 1,
    endTime: 2,
    text: 'Hello world',
    tokens: [
      { text: 'Hello ', startTime: 1, endTime: 1.4 },
      { text: 'world', startTime: 1.4, endTime: 2 },
    ],
  }];

  it('attaches exact companion timing and rejects stale edited text', () => {
    const exact = mergePreciseLyricTiming(parseLrc('[00:01.00]Hello world').lines, timing);
    const edited = mergePreciseLyricTiming(parseLrc('[00:01.00]Hello there').lines, timing);

    expect(exact[0].tokens).toHaveLength(2);
    expect(edited[0].tokens).toBeUndefined();
  });
});

describe('groupLyricLines', () => {
  it('groups bilingual rows with the same timestamp into one playback cue', () => {
    const lines = parseLrc(`
      [00:01.00]她在城东，每天都忙着工作
      [00:01.00]On the East-side of the city, she was working every day
      [00:04.00]Next line
    `).lines;

    const cues = groupLyricLines(lines);

    expect(cues).toHaveLength(2);
    expect(cues[0]).toMatchObject({
      time: 1,
      lines: [
        { text: 'On the East-side of the city, she was working every day', role: 'original' },
        { text: '她在城东，每天都忙着工作', role: 'translation' },
      ],
    });
    expect(cues[1].lines).toEqual([
      expect.objectContaining({ text: 'Next line', role: 'original' }),
    ]);
  });

  it('preserves input order when language roles are ambiguous', () => {
    const lines = parseLrc('[00:01.00]第一行\n[00:01.00]第二行').lines;
    const [cue] = groupLyricLines(lines);

    expect(cue.lines.map((line) => [line.text, line.role])).toEqual([
      ['第一行', 'original'],
      ['第二行', 'translation'],
    ]);
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
