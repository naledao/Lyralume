// @vitest-environment node

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LibraryDatabase } from '../library/database';
import { LibraryService } from '../library/service';
import type { StoredTrackLocation } from '../library/types';
import { TrackWriteCoordinator } from '../track-write-coordinator';
import { Kid3Adapter } from './kid3';
import {
  applyOffsetForEmbedding,
  LyricsOffsetError,
  LyricsOffsetService,
} from './lyrics-offset-service';
import { loadPreferredLyricsSource } from './lyrics-source';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  for (const directory of temporaryDirectories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

describe('applyOffsetForEmbedding', () => {
  it('bakes the total offset into every timestamp without emitting an offset tag', () => {
    const adjusted = applyOffsetForEmbedding(
      '[offset:500]\n[00:01.000]Early\n[00:05.250]Later',
      -2_000,
    );

    expect(adjusted).toBe('[00:00.000]Early\n[00:03.250]Later\n');
    expect(adjusted).not.toContain('[offset:');
  });

  it('rejects unsafe offsets', () => {
    expect(() => applyOffsetForEmbedding('[00:01.00]Line', 300_001))
      .toThrow(LyricsOffsetError);
  });
});

describe('LyricsOffsetService', () => {
  it('writes adjusted SYLT, verifies it, and makes embedded lyrics preferred', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'lyralume-offset-test-'));
    temporaryDirectories.push(directory);
    const lrcPath = path.join(directory, 'song.lrc');
    await writeFile(lrcPath, '[00:02.000]First\n[00:04.500]Second\n');
    const track: StoredTrackLocation = {
      id: '0123456789abcdef01234567',
      filePath: path.join(directory, 'song.mp3'),
      lrcPath,
      preferEmbeddedLyrics: false,
      title: 'Song',
      artist: 'Artist',
      album: 'Album',
      language: null,
      duration: 10,
    };
    const source = await loadPreferredLyricsSource(track);
    expect(source).toBeDefined();

    const database = {
      getTrackLocation: vi.fn(() => track),
      setTrackEmbeddedLyrics: vi.fn(() => true),
      setTrackPreferEmbeddedLyrics: vi.fn(() => true),
    } as unknown as LibraryDatabase;
    const library = { refreshSnapshot: vi.fn() } as unknown as LibraryService;
    const kid3 = { writeLyricsAndVerify: vi.fn().mockResolvedValue(undefined) } as unknown as Kid3Adapter;
    const service = new LyricsOffsetService(
      database,
      library,
      kid3,
      new TrackWriteCoordinator(),
    );

    await expect(service.writeAdjustedTiming(track.id, -500, source?.revision ?? ''))
      .resolves.toEqual({ appliedOffsetMs: -500, lineCount: 2, source: 'lrc' });
    expect(kid3.writeLyricsAndVerify).toHaveBeenCalledWith(
      track.filePath,
      '[00:01.500]First\n[00:04.000]Second\n',
      'Lyralume / Time Adjusted',
    );
    expect(database.setTrackEmbeddedLyrics).toHaveBeenCalledWith(track.id, true);
    expect(database.setTrackPreferEmbeddedLyrics).toHaveBeenCalledWith(track.id, true);
    expect(library.refreshSnapshot).toHaveBeenCalledOnce();
  });

  it('does not write when the loaded lyrics changed before confirmation', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'lyralume-offset-test-'));
    temporaryDirectories.push(directory);
    const lrcPath = path.join(directory, 'song.lrc');
    await writeFile(lrcPath, '[00:02.000]First\n');
    const track: StoredTrackLocation = {
      id: '0123456789abcdef01234567',
      filePath: path.join(directory, 'song.mp3'),
      lrcPath,
      preferEmbeddedLyrics: false,
      title: 'Song',
      artist: 'Artist',
      album: 'Album',
      language: null,
      duration: 10,
    };
    const database = { getTrackLocation: vi.fn(() => track) } as unknown as LibraryDatabase;
    const kid3 = { writeLyricsAndVerify: vi.fn() } as unknown as Kid3Adapter;
    const service = new LyricsOffsetService(
      database,
      { refreshSnapshot: vi.fn() } as unknown as LibraryService,
      kid3,
      new TrackWriteCoordinator(),
    );

    await expect(service.writeAdjustedTiming(track.id, 500, '0'.repeat(64)))
      .rejects.toMatchObject<LyricsOffsetError>({ kind: 'source_changed' });
    expect(kid3.writeLyricsAndVerify).not.toHaveBeenCalled();
  });
});
