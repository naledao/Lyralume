// @vitest-environment node

import { describe, expect, it } from 'vitest';
import { JsonLinesDecoder, parseWorkerMessage, WorkerProtocolError } from './worker-protocol';

const taskId = '1f93f29d-3d74-4bb0-8853-9e2348d4f0fb';

describe('local lyrics worker protocol', () => {
  it('parses versioned task-scoped progress and clamps its value', () => {
    expect(parseWorkerMessage(JSON.stringify({
      version: 1,
      type: 'progress',
      taskId,
      stage: 'separation',
      progress: 1.4,
      message: 'working',
    }), taskId)).toEqual({
      version: 1,
      type: 'progress',
      taskId,
      stage: 'separation',
      progress: 1,
      message: 'working',
    });
  });

  it('rejects output from another task and malformed JSON', () => {
    expect(() => parseWorkerMessage('{', taskId)).toThrow(WorkerProtocolError);
    expect(() => parseWorkerMessage(JSON.stringify({
      version: 1,
      type: 'result',
      taskId: 'another-task',
      stage: 'alignment',
      outputs: {},
    }), taskId)).toThrow(/任务 ID/);
  });

  it('decodes messages that arrive across arbitrary stream chunks', () => {
    const decoder = new JsonLinesDecoder();
    expect(decoder.push('{"one":1}\n{"two"')).toEqual(['{"one":1}']);
    expect(decoder.push(':2}\r\n')).toEqual(['{"two":2}']);
    expect(decoder.finish()).toEqual([]);
  });
});
