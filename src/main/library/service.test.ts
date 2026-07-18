// @vitest-environment node

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LibraryDatabase } from './database';
import { LibraryService, type TrackMetadataWriter } from './service';
import type { ScannedTrack } from './types';
import { UNKNOWN_ALBUM, UNKNOWN_ARTIST } from '../../shared/contracts';

const temporaryDirectories: string[] = [];
const databases: LibraryDatabase[] = [];
const services: LibraryService[] = [];

function scannedTrack(rootPath: string, filePath: string): ScannedTrack {
  return {
    id: '0123456789abcdef01234567',
    rootPath,
    filePath,
    fileName: 'track.mp3',
    title: 'Track',
    artist: 'Artist',
    album: 'Album',
    duration: 123.4,
    fileSize: 2048,
    modifiedAt: 42,
    lrcPath: null,
    artworkMime: null,
    artwork: null,
  };
}

afterEach(async () => {
  await Promise.all(services.splice(0).map((service) => service.close()));
  for (const database of databases.splice(0)) database.close();
  for (const directory of temporaryDirectories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

describe('LibraryService', () => {
  it('updates the database only after source-file metadata is written and verified', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'lyralume-service-test-'));
    temporaryDirectories.push(directory);
    const database = new LibraryDatabase(path.join(directory, 'library.db'));
    databases.push(database);
    const audioPath = path.join(directory, 'track.mp3');
    const track = scannedTrack(directory, audioPath);
    database.syncRoot(directory, [track], new Set([audioPath]));
    const writer: TrackMetadataWriter = {
      writeMetadataAndVerify: vi.fn(async () => undefined),
    };
    const service = new LibraryService(database, writer);
    services.push(service);

    const snapshot = await service.updateTrackMetadata(track.id, {
      title: 'Edited Title',
      artist: 'Edited Artist',
      album: 'Edited Album',
    });

    expect(writer.writeMetadataAndVerify).toHaveBeenCalledWith(audioPath, {
      title: 'Edited Title',
      artist: 'Edited Artist',
      album: 'Edited Album',
    });
    expect(snapshot.tracks[0]).toMatchObject({
      title: 'Edited Title',
      artist: 'Edited Artist',
      album: 'Edited Album',
    });
  });

  it('keeps existing library values when source-file writing fails', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'lyralume-service-test-'));
    temporaryDirectories.push(directory);
    const database = new LibraryDatabase(path.join(directory, 'library.db'));
    databases.push(database);
    const audioPath = path.join(directory, 'track.mp3');
    const track = scannedTrack(directory, audioPath);
    database.syncRoot(directory, [track], new Set([audioPath]));
    const writer: TrackMetadataWriter = {
      writeMetadataAndVerify: vi.fn(async () => {
        throw new Error('write failed');
      }),
    };
    const service = new LibraryService(database, writer);
    services.push(service);

    await expect(service.updateTrackMetadata(track.id, {
      title: 'Edited Title',
      artist: 'Edited Artist',
      album: 'Edited Album',
    })).rejects.toThrow('write failed');
    expect(database.getSnapshot().tracks[0]).toMatchObject({
      title: 'Track',
      artist: 'Artist',
      album: 'Album',
    });
  });

  it('updates only the requested field in the source file and library', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'lyralume-service-test-'));
    temporaryDirectories.push(directory);
    const database = new LibraryDatabase(path.join(directory, 'library.db'));
    databases.push(database);
    const audioPath = path.join(directory, 'track.mp3');
    const track = scannedTrack(directory, audioPath);
    database.syncRoot(directory, [track], new Set([audioPath]));
    const writer: TrackMetadataWriter = {
      writeMetadataAndVerify: vi.fn(async () => undefined),
    };
    const service = new LibraryService(database, writer);
    services.push(service);

    const snapshot = await service.updateTrackMetadata(track.id, { artist: 'Only Artist' });

    expect(writer.writeMetadataAndVerify).toHaveBeenCalledWith(audioPath, {
      artist: 'Only Artist',
    });
    expect(snapshot.tracks[0]).toMatchObject({
      title: 'Track',
      artist: 'Only Artist',
      album: 'Album',
    });
  });

  it('deletes empty metadata fields and exposes their display fallbacks', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'lyralume-service-test-'));
    temporaryDirectories.push(directory);
    const database = new LibraryDatabase(path.join(directory, 'library.db'));
    databases.push(database);
    const audioPath = path.join(directory, 'track.mp3');
    const track = scannedTrack(directory, audioPath);
    database.syncRoot(directory, [track], new Set([audioPath]));
    const writer: TrackMetadataWriter = {
      writeMetadataAndVerify: vi.fn(async () => undefined),
    };
    const service = new LibraryService(database, writer);
    services.push(service);

    const snapshot = await service.updateTrackMetadata(track.id, {
      title: '',
      artist: '',
      album: '',
    });

    expect(writer.writeMetadataAndVerify).toHaveBeenCalledWith(audioPath, {
      title: '',
      artist: '',
      album: '',
    });
    expect(snapshot.tracks[0]).toMatchObject({
      title: 'track',
      artist: UNKNOWN_ARTIST,
      album: UNKNOWN_ALBUM,
    });
  });

  it('reports completion after an entire scan operation finishes', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'lyralume-service-test-'));
    temporaryDirectories.push(directory);
    const database = new LibraryDatabase(path.join(directory, 'library.db'));
    databases.push(database);
    const service = new LibraryService(database);
    services.push(service);
    const onProgress = vi.fn();
    service.setListeners(vi.fn(), onProgress);

    await service.addAndScan(directory);

    expect(onProgress).toHaveBeenCalled();
    expect(onProgress.mock.lastCall?.[0]).toMatchObject({ completed: true });
  });
});
