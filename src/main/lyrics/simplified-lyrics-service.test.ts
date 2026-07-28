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
import { loadPreferredLyricsSource } from './lyrics-source';
import {
  simplifyLyricsForEmbedding,
  SimplifiedLyricsError,
  SimplifiedLyricsService,
} from './simplified-lyrics-service';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  for (const directory of temporaryDirectories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

describe('simplifyLyricsForEmbedding', () => {
  it('converts traditional lyrics while preserving rows and baking in the previewed offset', () => {
    const converted = simplifyLyricsForEmbedding(
      '[offset:500]\n[00:01.000]每個眼神都只身荒野\n[00:03.250]還不能回來',
      500,
    );

    expect(converted).toEqual({
      raw: '[00:01.500]每个眼神都只身荒野\n[00:03.750]还不能回来\n',
      lineCount: 2,
      changedLineCount: 2,
    });
  });

  it('keeps already simplified and non-Chinese rows unchanged', () => {
    const converted = simplifyLyricsForEmbedding(
      '[00:01.000]已经是简体\n[00:02.000]Fly me to the moon',
      0,
    );

    expect(converted.changedLineCount).toBe(0);
    expect(converted.lineCount).toBe(2);
  });
});

describe('SimplifiedLyricsService', () => {
  it('writes simplified SYLT to the same MP3 and makes the verified frame preferred', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'lyralume-simplified-test-'));
    temporaryDirectories.push(directory);
    const lrcPath = path.join(directory, 'song.lrc');
    await writeFile(lrcPath, '[00:02.000]相隔有千萬種\n[00:04.500]沒有掙扎 看誰先說\n');
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
    const service = new SimplifiedLyricsService(
      database,
      library,
      kid3,
      new TrackWriteCoordinator(),
    );

    await expect(service.write(track.id, -500, source?.revision ?? ''))
      .resolves.toEqual({
        appliedOffsetMs: -500,
        lineCount: 2,
        changedLineCount: 2,
        source: 'lrc',
      });
    expect(kid3.writeLyricsAndVerify).toHaveBeenCalledWith(
      track.filePath,
      '[00:01.500]相隔有千万种\n[00:04.000]没有挣扎 看谁先说\n',
      'Lyralume / Simplified zh-CN',
    );
    expect(database.setTrackEmbeddedLyrics).toHaveBeenCalledWith(track.id, true);
    expect(database.setTrackPreferEmbeddedLyrics).toHaveBeenCalledWith(track.id, true);
    expect(library.refreshSnapshot).toHaveBeenCalledOnce();
  });

  it('rejects non-MP3 files before attempting a tag write', async () => {
    const track = {
      id: '0123456789abcdef01234567',
      filePath: 'C:\\music\\song.flac',
    } as StoredTrackLocation;
    const kid3 = { writeLyricsAndVerify: vi.fn() } as unknown as Kid3Adapter;
    const service = new SimplifiedLyricsService(
      { getTrackLocation: vi.fn(() => track) } as unknown as LibraryDatabase,
      { refreshSnapshot: vi.fn() } as unknown as LibraryService,
      kid3,
      new TrackWriteCoordinator(),
    );

    await expect(service.write(track.id, 0, '0'.repeat(64)))
      .rejects.toMatchObject<SimplifiedLyricsError>({ kind: 'unsupported_format' });
    expect(kid3.writeLyricsAndVerify).not.toHaveBeenCalled();
  });
});
