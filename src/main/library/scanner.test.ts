// @vitest-environment node

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { scanRoot } from './scanner';

const temporaryDirectories: string[] = [];

function pcmWave(durationSeconds = 0.1, sampleRate = 8_000): Buffer {
  const samples = Math.floor(durationSeconds * sampleRate);
  const dataSize = samples * 2;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);
  return buffer;
}

afterEach(async () => {
  for (const directory of temporaryDirectories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

describe('scanRoot', () => {
  it('reads a real PCM WAV fixture and detects its sidecar LRC', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'lyralume-scan-test-'));
    temporaryDirectories.push(directory);
    const audioPath = path.join(directory, 'fixture.wav');
    const lyricsPath = path.join(directory, 'fixture.lrc');
    await writeFile(audioPath, pcmWave());
    await writeFile(lyricsPath, '[00:00.00]Fixture', 'utf8');

    const progress: number[] = [];
    const result = await scanRoot(directory, (item) => progress.push(item.processed));

    expect(result.warnings).toEqual([]);
    expect(result.discoveredPaths).toEqual(new Set([audioPath]));
    expect(result.tracks).toHaveLength(1);
    expect(result.tracks[0]).toMatchObject({
      fileName: 'fixture.wav',
      title: 'fixture',
      artist: '未知艺术家',
      language: null,
      lrcPath: lyricsPath,
    });
    expect(result.tracks[0].duration).toBeCloseTo(0.1, 2);
    expect(progress.at(-1)).toBe(1);
  });

  it('isolates a corrupt candidate as a warning', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'lyralume-scan-test-'));
    temporaryDirectories.push(directory);
    await writeFile(path.join(directory, 'broken.mp3'), 'not audio');

    const result = await scanRoot(directory);
    expect(result.discoveredPaths.size).toBe(1);
    expect(result.tracks).toHaveLength(0);
    expect(result.warnings[0].fileName).toBe('broken.mp3');
  });

  it('scans a single audio file dropped onto the application', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'lyralume-scan-test-'));
    temporaryDirectories.push(directory);
    const audioPath = path.join(directory, 'dropped.wav');
    const siblingPath = path.join(directory, 'not-dropped.wav');
    await writeFile(audioPath, pcmWave());
    await writeFile(siblingPath, pcmWave());

    const result = await scanRoot(audioPath);

    expect(result.discoveredPaths).toEqual(new Set([audioPath]));
    expect(result.tracks).toHaveLength(1);
    expect(result.tracks[0].fileName).toBe('dropped.wav');
  });
});
