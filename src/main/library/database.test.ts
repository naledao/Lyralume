// @vitest-environment node

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { LibraryDatabase } from './database';
import type { ScannedTrack } from './types';

const temporaryDirectories: string[] = [];

async function createDatabase(): Promise<{ database: LibraryDatabase; directory: string }> {
  const directory = await mkdtemp(path.join(tmpdir(), 'lyralume-db-test-'));
  temporaryDirectories.push(directory);
  return { database: new LibraryDatabase(path.join(directory, 'library.db')), directory };
}

function scannedTrack(rootPath: string, filePath: string): ScannedTrack {
  return {
    id: '0123456789abcdef01234567',
    rootPath,
    filePath,
    fileName: 'track.flac',
    title: 'Track',
    artist: 'Artist',
    album: 'Album',
    duration: 123.4,
    fileSize: 2048,
    modifiedAt: 42,
    lrcPath: `${filePath.slice(0, -5)}.lrc`,
    artworkMime: 'image/png',
    artwork: Buffer.from([1, 2, 3]),
  };
}

afterEach(async () => {
  for (const directory of temporaryDirectories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

describe('LibraryDatabase', () => {
  it('persists tracks but exposes only controlled media URLs', async () => {
    const { database, directory } = await createDatabase();
    const musicPath = path.join(directory, 'track.flac');
    database.syncRoot(directory, [scannedTrack(directory, musicPath)], new Set([musicPath]));

    const snapshot = database.getSnapshot();
    expect(snapshot.roots).toHaveLength(1);
    expect(snapshot.tracks).toEqual([
      expect.objectContaining({
        title: 'Track',
        hasLyrics: true,
        hasArtwork: true,
        playbackUrl: 'lyralume-media://track/0123456789abcdef01234567',
      }),
    ]);
    expect(JSON.stringify(snapshot.tracks)).not.toContain(musicPath);
    expect(database.getTrackLocation('0123456789abcdef01234567')?.filePath).toBe(musicPath);
    expect(database.getArtwork('0123456789abcdef01234567')?.data).toEqual(Buffer.from([1, 2, 3]));
    database.close();
  });

  it('removes a record only after its file is no longer discovered', async () => {
    const { database, directory } = await createDatabase();
    const musicPath = path.join(directory, 'track.flac');
    const track = scannedTrack(directory, musicPath);
    database.syncRoot(directory, [track], new Set([musicPath]));
    database.syncRoot(directory, [], new Set([musicPath]));
    expect(database.getSnapshot().tracks).toHaveLength(1);
    database.syncRoot(directory, [], new Set());
    expect(database.getSnapshot().tracks).toHaveLength(0);
    database.close();
  });

  it('keeps edited artist and album values when the audio file is rescanned', async () => {
    const { database, directory } = await createDatabase();
    const musicPath = path.join(directory, 'track.flac');
    const track = scannedTrack(directory, musicPath);
    database.syncRoot(directory, [track], new Set([musicPath]));

    expect(database.setTrackMetadata(track.id, {
      title: 'Edited Title',
      artist: 'Edited Artist',
      album: 'Edited Album',
    })).toBe(true);
    database.syncRoot(directory, [track], new Set([musicPath]));

    expect(database.getSnapshot().tracks[0]).toMatchObject({
      title: 'Edited Title',
      artist: 'Edited Artist',
      album: 'Edited Album',
    });
    expect(database.getTrackLocation(track.id)).toMatchObject({
      title: 'Edited Title',
      artist: 'Edited Artist',
      album: 'Edited Album',
    });
    database.close();
  });

  it('persists the preference for verified embedded lyrics across rescans', async () => {
    const { database, directory } = await createDatabase();
    const musicPath = path.join(directory, 'track.flac');
    const track = scannedTrack(directory, musicPath);
    database.syncRoot(directory, [track], new Set([musicPath]));

    expect(database.getTrackLocation(track.id)?.preferEmbeddedLyrics).toBe(false);
    expect(database.setTrackPreferEmbeddedLyrics(track.id, true)).toBe(true);
    database.syncRoot(directory, [track], new Set([musicPath]));

    expect(database.getTrackLocation(track.id)?.preferEmbeddedLyrics).toBe(true);
    database.close();
  });

  it('returns to sidecar lyrics preference when a new LRC is explicitly saved', async () => {
    const { database, directory } = await createDatabase();
    const musicPath = path.join(directory, 'track.mp3');
    const track = scannedTrack(directory, musicPath);
    database.syncRoot(directory, [track], new Set([musicPath]));
    database.setTrackPreferEmbeddedLyrics(track.id, true);

    expect(database.setTrackLrcPath(track.id, path.join(directory, 'track.lrc'))).toBe(true);
    expect(database.getTrackLocation(track.id)?.preferEmbeddedLyrics).toBe(false);
    database.close();
  });

  it('removes a folder track without deleting its root and keeps it ignored on rescan', async () => {
    const { database, directory } = await createDatabase();
    const musicPath = path.join(directory, 'track.flac');
    const track = scannedTrack(directory, musicPath);
    database.syncRoot(directory, [track], new Set([musicPath]));

    expect(database.removeTrack(track.id)).toMatchObject({ rootRemoved: false, filePath: musicPath });
    expect(database.getSnapshot()).toMatchObject({ tracks: [], roots: [{ path: directory }] });

    database.syncRoot(directory, [track], new Set([musicPath]));
    expect(database.getSnapshot().tracks).toHaveLength(0);

    database.clearIgnoredForImport(musicPath);
    database.syncRoot(directory, [track], new Set([musicPath]));
    expect(database.getSnapshot().tracks).toHaveLength(1);
    database.close();
  });

  it('removes a single-file library root together with its track', async () => {
    const { database, directory } = await createDatabase();
    const musicPath = path.join(directory, 'track.flac');
    const track = scannedTrack(musicPath, musicPath);
    database.syncRoot(musicPath, [track], new Set([musicPath]));

    expect(database.removeTrack(track.id)).toMatchObject({ rootRemoved: true, rootPath: musicPath });
    expect(database.getSnapshot()).toEqual({ tracks: [], roots: [] });
    database.close();
  });
});
