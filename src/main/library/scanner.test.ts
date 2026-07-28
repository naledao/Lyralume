// @vitest-environment node

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { IAudioMetadata } from 'music-metadata';
import { afterEach, describe, expect, it, vi } from 'vitest';
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

function mp3Metadata(lyrics: unknown[]): IAudioMetadata {
  return {
    format: {
      container: 'MPEG',
      codec: 'MPEG 1 Layer 3',
      duration: 120,
      tagTypes: ['ID3v2.3'],
      trackInfo: [],
    },
    common: {
      track: { no: null, of: null },
      disk: { no: null, of: null },
      movementIndex: { no: null, of: null },
      title: 'Tagged Song',
      artist: 'Artist',
      album: 'Album',
      lyrics,
    },
    native: {},
    quality: { warnings: [] },
  } as unknown as IAudioMetadata;
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

  it('migrates timestamped MP3 text lyrics to syncText before importing', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'lyralume-scan-test-'));
    temporaryDirectories.push(directory);
    const audioPath = path.join(directory, 'text-lyrics.mp3');
    await writeFile(audioPath, 'audio');
    const sourceLyrics = '[00:01.000]First\n[00:02.500]Second\n';
    const readMetadata = vi.fn()
      .mockResolvedValueOnce(mp3Metadata([{ language: 'chi', text: sourceLyrics }]))
      .mockResolvedValueOnce(mp3Metadata([{
        descriptor: 'Lyralume / Imported USLT',
        syncText: [
          { timestamp: 1_000, text: 'First' },
          { timestamp: 2_500, text: 'Second' },
        ],
      }]));
    const migrateUnsynchronizedLyrics = vi.fn(async () => undefined);

    const result = await scanRoot(audioPath, undefined, {
      readMetadata,
      migrateUnsynchronizedLyrics,
    });

    expect(migrateUnsynchronizedLyrics).toHaveBeenCalledWith(audioPath, sourceLyrics);
    expect(readMetadata).toHaveBeenCalledTimes(2);
    expect(result.warnings).toEqual([]);
    expect(result.tracks).toHaveLength(1);
    expect(result.tracks[0].hasEmbeddedLyrics).toBe(true);
  });

  it('does not import an MP3 when its text lyrics cannot be converted', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'lyralume-scan-test-'));
    temporaryDirectories.push(directory);
    const audioPath = path.join(directory, 'plain-text-lyrics.mp3');
    await writeFile(audioPath, 'audio');
    const readMetadata = vi.fn(async () => mp3Metadata([{
      language: 'chi',
      text: 'These lyrics have no timestamps',
    }]));
    const migrateUnsynchronizedLyrics = vi.fn(async () => {
      throw new Error('内嵌 text 歌词不包含有效的 LRC 同步时间戳');
    });

    const result = await scanRoot(audioPath, undefined, {
      readMetadata,
      migrateUnsynchronizedLyrics,
    });

    expect(result.tracks).toHaveLength(0);
    expect(result.warnings).toEqual([{
      fileName: 'plain-text-lyrics.mp3',
      message: '内嵌 text 歌词不包含有效的 LRC 同步时间戳',
    }]);
  });
});
