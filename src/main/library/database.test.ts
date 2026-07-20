// @vitest-environment node

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LibraryDatabase } from './database';
import type { ScannedTrack } from './types';
import { createFallbackProfile, createVisualDNA } from '../../shared/visual-analysis';

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
    language: null,
    duration: 123.4,
    fileSize: 2048,
    modifiedAt: 42,
    lrcPath: `${filePath.slice(0, -5)}.lrc`,
    artworkMime: 'image/png',
    artwork: Buffer.from([1, 2, 3]),
  };
}

afterEach(async () => {
  vi.restoreAllMocks();
  for (const directory of temporaryDirectories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

describe('LibraryDatabase', () => {
  it('sorts songs by first-added time and preserves that order across rescans', async () => {
    const { database, directory } = await createDatabase();
    const olderPath = path.join(directory, 'older.flac');
    const newerPath = path.join(directory, 'newer.flac');
    const older = {
      ...scannedTrack(directory, olderPath),
      id: '111111111111111111111111',
      fileName: 'older.flac',
      title: 'Zebra',
    };
    const newer = {
      ...scannedTrack(directory, newerPath),
      id: '222222222222222222222222',
      fileName: 'newer.flac',
      title: 'Alpha',
    };
    const now = vi.spyOn(Date, 'now');

    now.mockReturnValue(1_000);
    database.syncRoot(directory, [older], new Set([olderPath]));
    now.mockReturnValue(2_000);
    database.syncRoot(directory, [older, newer], new Set([olderPath, newerPath]));

    expect(database.getSnapshot().tracks.map((track) => track.id)).toEqual([newer.id, older.id]);

    now.mockReturnValue(3_000);
    database.syncRoot(directory, [older, newer], new Set([olderPath, newerPath]));
    expect(database.getSnapshot().tracks.map((track) => track.id)).toEqual([newer.id, older.id]);
    database.close();
  });

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

  it('keeps a selected language across rescans and supports clearing it', async () => {
    const { database, directory } = await createDatabase();
    const musicPath = path.join(directory, 'track.flac');
    const track = scannedTrack(directory, musicPath);
    database.syncRoot(directory, [track], new Set([musicPath]));

    expect(database.setTrackMetadata(track.id, { language: 'jpn' })).toBe(true);
    database.syncRoot(directory, [{ ...track, language: 'eng' }], new Set([musicPath]));
    expect(database.getSnapshot().tracks[0].language).toBe('jpn');
    expect(database.getTrackLocation(track.id)?.language).toBe('jpn');

    expect(database.setTrackMetadata(track.id, { language: '' })).toBe(true);
    database.syncRoot(directory, [{ ...track, language: 'eng' }], new Set([musicPath]));
    expect(database.getSnapshot().tracks[0].language).toBeNull();
    expect(database.getTrackLocation(track.id)?.language).toBeNull();
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

  it('persists the latest playback checkpoint and active track', async () => {
    const { database, directory } = await createDatabase();
    const musicPath = path.join(directory, 'track.flac');
    const track = scannedTrack(directory, musicPath);
    database.syncRoot(directory, [track], new Set([musicPath]));

    const saved = database.savePlaybackCheckpoint({
      trackId: track.id,
      positionMs: 42_250,
      durationMs: 123_400,
      completed: false,
      reason: 'pause',
    });

    expect(saved).toMatchObject({ positionMs: 42_250, durationMs: 123_400 });
    expect(database.getPlaybackState()).toMatchObject({
      lastTrackId: track.id,
      progress: [expect.objectContaining({
        trackId: track.id,
        positionMs: 42_250,
        completed: false,
        reason: 'pause',
      })],
    });
    database.close();
  });

  it('resets completed playback and retains progress when a library record is removed', async () => {
    const { database, directory } = await createDatabase();
    const musicPath = path.join(directory, 'track.flac');
    const track = scannedTrack(directory, musicPath);
    database.syncRoot(directory, [track], new Set([musicPath]));
    database.savePlaybackCheckpoint({
      trackId: track.id,
      positionMs: 123_400,
      durationMs: 123_400,
      completed: true,
      reason: 'ended',
    });

    database.removeTrack(track.id);

    expect(database.getPlaybackState().progress).toEqual([
      expect.objectContaining({
        trackId: track.id,
        positionMs: 0,
        completed: true,
      }),
    ]);
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

  it('persists visual analysis and preserves the last good result after failure', async () => {
    const { database, directory } = await createDatabase();
    const musicPath = path.join(directory, 'track.flac');
    const track = scannedTrack(directory, musicPath);
    database.syncRoot(directory, [track], new Set([musicPath]));
    const profile = createFallbackProfile();
    const visualDNA = createVisualDNA(profile, track.id);

    database.saveVisualAnalysis({
      trackId: track.id,
      status: 'ready',
      progress: 1,
      analysisVersion: profile.analysisVersion,
      mappingVersion: visualDNA.mappingVersion,
      sourceSize: track.fileSize,
      sourceModifiedAt: track.modifiedAt,
      profile,
      timeline: { beatsMs: [100, 600], sections: [] },
      visualDNA,
      updatedAt: 1,
    });
    database.saveVisualAnalysis({
      ...database.getVisualAnalysis(track.id)!,
      status: 'failed',
      error: 'decoder failed',
      profile: undefined,
      timeline: undefined,
      visualDNA: undefined,
      updatedAt: 2,
    });

    expect(database.getVisualAnalysis(track.id)).toMatchObject({
      status: 'failed',
      error: 'decoder failed',
      profile,
      visualDNA,
    });
    database.close();
  });
});
