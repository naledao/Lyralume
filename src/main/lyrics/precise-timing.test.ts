// @vitest-environment node

import { describe, expect, it } from 'vitest';
import type { LocalLyricsTask } from '../../shared/contracts';
import { preciseTimingForLocalTask } from './precise-timing';

function task(): LocalLyricsTask {
  return {
    id: 'task-1',
    trackId: 'track-1',
    status: 'lrc_saved',
    stage: 'confirmation',
    progress: 1,
    message: 'saved',
    draftLines: [{
      id: 'line-1',
      startTime: 1,
      endTime: 2,
      text: 'Hello world',
      confidence: 0.9,
      flags: [],
      tokens: [
        { text: 'Hello ', startTime: 1, endTime: 1.4 },
        { text: 'world', startTime: 1.4, endTime: 2 },
      ],
    }],
    draftOffsetMs: 250,
    lowConfidenceCount: 0,
    lrcSaveStatus: 'saved',
    tagWriteStatus: 'not_started',
    createdAt: 1,
    updatedAt: 2,
  };
}

describe('preciseTimingForLocalTask', () => {
  it('applies the confirmed draft offset to line and token timing', () => {
    expect(preciseTimingForLocalTask(task(), 'lrc')).toEqual([expect.objectContaining({
      time: 1.25,
      endTime: 2.25,
      tokens: [
        expect.objectContaining({ startTime: 1.25, endTime: 1.65 }),
        expect.objectContaining({ startTime: 1.65, endTime: 2.25 }),
      ],
    })]);
  });

  it('does not attach timing to a source that was not confirmed by the task', () => {
    expect(preciseTimingForLocalTask(task(), 'embedded')).toBeUndefined();
  });
});
