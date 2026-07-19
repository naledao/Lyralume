// @vitest-environment node

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { SeparationWorkerRequest } from './worker-protocol';
import { createWorkerEnvironment, runWorkerProcess } from './worker-process';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => (
    rm(directory, { recursive: true, force: true })
  )));
});

describe('local lyrics worker process', () => {
  it('forces Python standard streams to UTF-8', () => {
    expect(createWorkerEnvironment({ EXISTING_VALUE: 'kept' })).toMatchObject({
      EXISTING_VALUE: 'kept',
      PYTHONUTF8: '1',
      PYTHONIOENCODING: 'utf-8',
    });
  });

  it('preserves a Chinese source path across the JSON Lines process boundary', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'lyralume-worker-process-'));
    temporaryDirectories.push(directory);
    const scriptPath = path.join(directory, 'echo-worker.cjs');
    await writeFile(scriptPath, `
      process.stdin.setEncoding('utf8');
      let raw = '';
      process.stdin.on('data', (chunk) => { raw += chunk; });
      process.stdin.on('end', () => {
        const request = JSON.parse(raw);
        process.stdout.write(JSON.stringify({
          version: 1,
          type: 'result',
          taskId: request.taskId,
          stage: 'separation',
          outputs: {
            inputPath: request.inputPath,
            pythonUtf8: process.env.PYTHONUTF8,
            pythonIoEncoding: process.env.PYTHONIOENCODING,
          },
        }) + '\\n');
      });
    `, 'utf8');

    const inputPath = String.raw`C:\Users\ksdy\Music\爱说.mp3`;
    const request: SeparationWorkerRequest = {
      version: 1,
      type: 'request',
      taskId: '7a688128-3480-4ca5-ab46-c5710bc3bf0f',
      action: 'separate',
      inputPath,
      outputPath: String.raw`C:\cache\vocals.wav`,
      modelDirectory: String.raw`C:\cache\models`,
      modelName: 'model.ckpt',
      modelSource: 'managed',
      device: 'cuda',
    };

    const result = await runWorkerProcess({
      executable: process.execPath,
      scriptPath,
      request,
      timeoutMs: 10_000,
    });

    expect(result.outputs).toMatchObject({
      inputPath,
      pythonUtf8: '1',
      pythonIoEncoding: 'utf-8',
    });
  });
});
