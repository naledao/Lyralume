// @vitest-environment node

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LibraryDatabase } from '../library/database';
import { LibraryService } from '../library/service';
import type { ScannedTrack } from '../library/types';
import { TrackWriteCoordinator } from '../track-write-coordinator';
import { Kid3Adapter, Kid3Error, type ProcessRunner, type SyltReader } from './kid3';
import { LrclibClient } from './lrclib';
import { OnlineLyricsService } from './online-lyrics-service';

const TRACK_ID = '0123456789abcdef01234567';
const temporaryDirectories: string[] = [];
const databases: LibraryDatabase[] = [];

const lrclibPayload = [{
  id: 42,
  trackName: 'Track',
  artistName: 'Artist',
  albumName: 'Album',
  duration: 123.4,
  instrumental: false,
  plainLyrics: 'First\nSecond',
  syncedLyrics: '[00:01.00]First\n[00:02.00]Second',
}];

async function setup(
  fetchImplementation: typeof fetch,
  runner?: ProcessRunner,
  syltReader?: SyltReader,
) {
  const directory = await mkdtemp(path.join(tmpdir(), 'lyralume-online-test-'));
  temporaryDirectories.push(directory);
  const audioPath = path.join(directory, 'track.flac');
  await writeFile(audioPath, 'audio-content');
  const database = new LibraryDatabase(path.join(directory, 'library.db'));
  databases.push(database);
  const track: ScannedTrack = {
    id: TRACK_ID,
    rootPath: directory,
    filePath: audioPath,
    fileName: 'track.flac',
    title: 'Track',
    artist: 'Artist',
    album: 'Album',
    language: null,
    duration: 123.4,
    fileSize: 13,
    modifiedAt: 1,
    lrcPath: null,
    artworkMime: null,
    artwork: null,
  };
  database.syncRoot(directory, [track], new Set([audioPath]));
  const library = new LibraryService(database);
  const service = new OnlineLyricsService(
    database,
    library,
    new LrclibClient(fetchImplementation),
    new Kid3Adapter(path.join(directory, 'cache'), runner, syltReader),
    new TrackWriteCoordinator(),
  );
  return { audioPath, database, service };
}

afterEach(async () => {
  for (const database of databases.splice(0)) database.close();
  for (const directory of temporaryDirectories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

describe('OnlineLyricsService', () => {
  it('writes a selected candidate directly without creating a sidecar LRC', async () => {
    const fetchImplementation = vi.fn(async () => new Response(JSON.stringify(lrclibPayload))) as typeof fetch;
    const runner: ProcessRunner = vi.fn(async (_executable, args) => ({
      stdout: args[1] === 'get "SYLT.Text Encoding" 2' ? '1\n' : '',
      stderr: '',
    }));
    const syltReader: SyltReader = vi.fn(async () => [{
      descriptor: 'Lyralume / LRCLIB',
      syncText: [
        { timestamp: 1000, text: '\n First' },
        { timestamp: 2000, text: '\n Second' },
      ],
    }]);
    const { audioPath, database, service } = await setup(
      fetchImplementation,
      runner,
      syltReader,
    );
    await service.search(TRACK_ID);

    const result = await service.writeTag(TRACK_ID, 42);

    expect(result).toMatchObject({
      status: 'completed',
      selectedCandidateId: 42,
      lrcSaveStatus: 'not_started',
      tagWriteStatus: 'verified',
    });
    await expect(readFile(path.join(path.dirname(audioPath), 'track.lrc'), 'utf8')).rejects.toThrow();
    expect(database.getSnapshot().tracks[0].hasLyrics).toBe(true);
  });

  it('queries, persists candidates, and safely saves the selected sidecar', async () => {
    const fetchImplementation = vi.fn(async () => new Response(JSON.stringify(lrclibPayload))) as typeof fetch;
    const { audioPath, database, service } = await setup(fetchImplementation);
    const queried = await service.search(TRACK_ID);
    expect(queried).toMatchObject({ status: 'awaiting_confirmation', selectedCandidateId: 42 });
    expect(database.getOnlineLyricsTask(TRACK_ID)?.candidates).toHaveLength(1);

    const saved = await service.save(TRACK_ID, 42);
    expect(saved).toMatchObject({ status: 'saved', lrcSaveStatus: 'saved', lrcFileName: 'track.lrc' });
    expect(await readFile(path.join(path.dirname(audioPath), 'track.lrc'), 'utf8')).toContain('First');
    expect(database.getSnapshot().tracks[0].hasLyrics).toBe(true);
  });

  it('resets a completed save before returning fresh search candidates', async () => {
    const fetchImplementation = vi.fn(async () => new Response(JSON.stringify(lrclibPayload))) as typeof fetch;
    const { service } = await setup(fetchImplementation);
    await service.search(TRACK_ID);
    const saved = await service.save(TRACK_ID, 42);
    expect(saved.lrcSaveStatus).toBe('saved');

    const refreshed = await service.search(TRACK_ID);

    expect(refreshed).toMatchObject({
      status: 'awaiting_confirmation',
      lrcSaveStatus: 'not_started',
      tagWriteStatus: 'not_started',
    });
    expect(refreshed.lrcFileName).toBeUndefined();
    expect(refreshed.candidates).toHaveLength(1);
    expect(fetchImplementation).toHaveBeenCalledTimes(2);
  });

  it('keeps an existing LRC until the user explicitly confirms overwrite', async () => {
    const fetchImplementation = vi.fn(async () => new Response(JSON.stringify(lrclibPayload))) as typeof fetch;
    const { audioPath, service } = await setup(fetchImplementation);
    await service.search(TRACK_ID);
    const lrcPath = path.join(path.dirname(audioPath), 'track.lrc');
    await writeFile(lrcPath, '[00:00.00]Existing');

    const refused = await service.save(TRACK_ID, 42);
    expect(refused.error?.code).toBe('existing_lrc');
    expect(await readFile(lrcPath, 'utf8')).toContain('Existing');

    const overwritten = await service.save(TRACK_ID, 42, true);
    expect(overwritten.lrcSaveStatus).toBe('saved');
    expect(await readFile(lrcPath, 'utf8')).toContain('First');
  });

  it('reports offline/no-result states without affecting the library', async () => {
    const offlineFetch = vi.fn(async () => {
      throw new TypeError('offline');
    }) as typeof fetch;
    const offline = await setup(offlineFetch);
    expect((await offline.service.search(TRACK_ID)).error?.code).toBe('network_error');
    expect(offline.database.getSnapshot().tracks).toHaveLength(1);

    const emptyFetch = vi.fn(async () => new Response('[]')) as typeof fetch;
    const empty = await setup(emptyFetch);
    expect((await empty.service.search(TRACK_ID)).error?.code).toBe('no_match');
    expect(empty.database.getSnapshot().tracks).toHaveLength(1);
  });

  it('preserves the saved LRC when kid3-cli is unavailable', async () => {
    const fetchImplementation = vi.fn(async () => new Response(JSON.stringify(lrclibPayload))) as typeof fetch;
    const missingKid3: ProcessRunner = async () => {
      throw new Kid3Error('not_found', '未找到 kid3-cli');
    };
    const { audioPath, service } = await setup(fetchImplementation, missingKid3);
    await service.search(TRACK_ID);
    await service.save(TRACK_ID, 42);
    const result = await service.writeTag(TRACK_ID);
    expect(result).toMatchObject({
      status: 'failed',
      lrcSaveStatus: 'saved',
      tagWriteStatus: 'failed',
      error: { code: 'kid3_not_found' },
    });
    await expect(readFile(path.join(path.dirname(audioPath), 'track.lrc'), 'utf8')).resolves.toContain('First');
  });

  it('turns a persisted in-progress task into a retryable interrupted state', async () => {
    const fetchImplementation = vi.fn(async () => new Response(JSON.stringify(lrclibPayload))) as typeof fetch;
    const { database, service } = await setup(fetchImplementation);
    database.saveOnlineLyricsTask({
      id: `online-${TRACK_ID}`,
      trackId: TRACK_ID,
      status: 'querying',
      source: 'lrclib',
      candidates: [],
      lrcSaveStatus: 'not_started',
      tagWriteStatus: 'not_started',
      updatedAt: 1,
    });
    expect(service.getTask(TRACK_ID)).toMatchObject({
      status: 'failed',
      error: { code: 'task_interrupted' },
    });
  });

  it('does not mistake a live query for an interrupted task', async () => {
    let resolveResponse: ((response: Response) => void) | undefined;
    const response = new Promise<Response>((resolve) => {
      resolveResponse = resolve;
    });
    const fetchImplementation = vi.fn(() => response) as typeof fetch;
    const { service } = await setup(fetchImplementation);
    const pending = service.search(TRACK_ID);
    await vi.waitFor(() => expect(service.getTask(TRACK_ID).status).toBe('querying'));
    resolveResponse?.(new Response(JSON.stringify(lrclibPayload)));
    await expect(pending).resolves.toMatchObject({ status: 'awaiting_confirmation' });
  });
});
