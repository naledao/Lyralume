import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LibraryDatabase } from '../library/database.js';
import type { ScannedTrack } from '../library/types.js';
import { AppSettingsService } from '../settings/app-settings.js';
import type { CredentialProtector } from '../settings/credential-protector.js';
import { TrackWriteCoordinator } from '../track-write-coordinator.js';
import type {
  MinioGateway,
  RemoteObjectInfo,
} from './minio-client.js';
import { catalogEntryFromObject, RemoteSyncService } from './service.js';

class FakeMinioGateway implements MinioGateway {
  readonly objects = new Map<string, RemoteObjectInfo>();
  bucketAvailable = true;
  makeBucketCount = 0;
  putCount = 0;

  async bucketExists(): Promise<boolean> {
    return this.bucketAvailable;
  }

  async makeBucket(): Promise<void> {
    this.makeBucketCount += 1;
    this.bucketAvailable = true;
  }

  async listObjects(_bucket: string, prefix: string): Promise<RemoteObjectInfo[]> {
    return [...this.objects.values()].filter((item) => item.name.startsWith(prefix));
  }

  async putFile(
    _bucket: string,
    objectName: string,
    filePath: string,
    metadata: Record<string, string>,
  ): Promise<{ etag: string }> {
    const contents = await readFile(filePath);
    const fileStat = await stat(filePath);
    this.putCount += 1;
    this.objects.set(objectName, {
      name: objectName,
      size: contents.byteLength,
      etag: `etag-${this.putCount}`,
      lastModified: new Date(fileStat.mtimeMs),
      metadata,
    });
    return { etag: `etag-${this.putCount}` };
  }

  async statObject(_bucket: string, objectName: string): Promise<RemoteObjectInfo> {
    const object = this.objects.get(objectName);
    if (!object) throw new Error('not found');
    return object;
  }
}

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('Timed out waiting for sync');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe('RemoteSyncService', () => {
  let root = '';
  let database: LibraryDatabase;
  let settings: AppSettingsService;
  let gateway: FakeMinioGateway;
  let track: ScannedTrack;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'lyralume-remote-sync-'));
    const audioPath = path.join(root, '测试歌曲.mp3');
    await writeFile(audioPath, Buffer.from('original-audio-bytes'));
    const fileStat = await stat(audioPath);
    track = {
      id: 'a'.repeat(24),
      rootPath: root,
      filePath: audioPath,
      fileName: '测试歌曲.mp3',
      title: '测试歌曲',
      artist: '测试歌手',
      album: '测试专辑',
      language: null,
      duration: 180,
      fileSize: fileStat.size,
      modifiedAt: fileStat.mtimeMs,
      lrcPath: null,
      hasEmbeddedLyrics: false,
      artworkMime: null,
      artwork: null,
    };
    database = new LibraryDatabase(path.join(root, 'library.db'));
    database.syncRoot(root, [track], new Set([audioPath]));
    const credentials: CredentialProtector = {
      isAvailable: vi.fn(async () => true),
      encrypt: vi.fn(async (value: string) => Buffer.from(value)),
      decrypt: vi.fn(async (value: Buffer) => value.toString('utf8')),
    };
    settings = new AppSettingsService(
      root,
      root,
      { apply: vi.fn(async () => undefined) },
      credentials,
    );
    await settings.initialize();
    await settings.updateMinio({
      endpoint: 'http://minio.test:9000',
      bucket: 'lyralume-music',
      accessKey: 'sync-client',
      secretKey: 'secret',
      autoSync: false,
    });
    gateway = new FakeMinioGateway();
  });

  afterEach(async () => {
    database.close();
    await rm(root, { recursive: true, force: true });
  });

  it('hashes, uploads and verifies a local track, then exposes it in the remote catalog', async () => {
    const service = new RemoteSyncService(
      database,
      settings,
      new TrackWriteCoordinator(),
      () => gateway,
    );
    await service.initialize(database.getSnapshot());
    await service.refresh();
    await service.syncTrack(track.id);
    await waitFor(() => database.getRemoteSyncRecord(track.id)?.status === 'synced');

    const record = database.getRemoteSyncRecord(track.id)!;
    const snapshot = await service.getSnapshot();
    expect(gateway.putCount).toBe(1);
    expect(record.localSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(record.objectName).toMatch(/^lyralume\/v1\/tracks\/.+\/audio\.mp3$/);
    expect(snapshot).toMatchObject({ configured: true, online: true });
    expect(snapshot.items).toEqual([
      expect.objectContaining({
        title: '测试歌曲',
        artist: '测试歌手',
        syncStatus: 'synced',
        localTrackId: track.id,
      }),
    ]);
    await service.close();
  });

  it('automatically creates a missing bucket during the connection test', async () => {
    gateway.bucketAvailable = false;
    const service = new RemoteSyncService(
      database,
      settings,
      new TrackWriteCoordinator(),
      () => gateway,
    );

    await expect(service.testConnection()).resolves.toMatchObject({
      ok: true,
      message: 'MinIO 连接成功，已自动创建 Bucket “lyralume-music”',
    });
    expect(gateway.makeBucketCount).toBe(1);
    expect(gateway.bucketAvailable).toBe(true);
    await service.close();
  });

  it('queues changed files again when automatic sync is enabled', async () => {
    await settings.updateMinio({
      endpoint: 'http://minio.test:9000',
      bucket: 'lyralume-music',
      accessKey: 'sync-client',
      autoSync: true,
    });
    const service = new RemoteSyncService(
      database,
      settings,
      new TrackWriteCoordinator(),
      () => gateway,
    );
    await service.initialize(database.getSnapshot());
    await waitFor(() => database.getRemoteSyncRecord(track.id)?.status === 'synced');

    await writeFile(track.filePath, Buffer.from('changed-audio-bytes-with-new-content'));
    const changedStat = await stat(track.filePath);
    const changed = { ...track, fileSize: changedStat.size, modifiedAt: changedStat.mtimeMs };
    database.syncRoot(root, [changed], new Set([track.filePath]));
    service.onLibraryChanged(database.getSnapshot());
    await waitFor(() => (
      database.getRemoteSyncRecord(track.id)?.status === 'synced'
      && gateway.putCount === 2
    ));

    expect(database.getRemoteSyncRecord(track.id)?.localSize).toBe(changedStat.size);
    await service.close();
  });

  it('keeps separate remote identities for duplicate files that are both active', async () => {
    const duplicatePath = path.join(root, '副本.mp3');
    await writeFile(duplicatePath, Buffer.from('original-audio-bytes'));
    const duplicateStat = await stat(duplicatePath);
    const duplicate: ScannedTrack = {
      ...track,
      id: 'b'.repeat(24),
      filePath: duplicatePath,
      fileName: '副本.mp3',
      title: '副本',
      fileSize: duplicateStat.size,
      modifiedAt: duplicateStat.mtimeMs,
    };
    database.syncRoot(root, [track, duplicate], new Set([track.filePath, duplicatePath]));
    const service = new RemoteSyncService(
      database,
      settings,
      new TrackWriteCoordinator(),
      () => gateway,
    );
    await service.initialize(database.getSnapshot());
    await service.refresh();
    await service.syncAll();
    await waitFor(() => database.getRemoteSyncRecords().filter((record) => (
      record.status === 'synced'
    )).length === 2);

    const records = database.getRemoteSyncRecords();
    expect(new Set(records.map((record) => record.syncId)).size).toBe(2);
    expect(gateway.putCount).toBe(2);
    await service.close();
  });
});

describe('catalogEntryFromObject', () => {
  it('decodes UTF-8 song metadata from safe ASCII object headers', () => {
    const encode = (value: string): string => Buffer.from(value).toString('base64url');
    expect(catalogEntryFromObject({
      name: 'lyralume/v1/tracks/7d0a144f-5dd1-4501-a213-2299ce0c07f4/audio.flac',
      size: 42,
      etag: 'etag',
      lastModified: new Date(100),
      metadata: {
        'x-amz-meta-lyralume-sync-id': '7d0a144f-5dd1-4501-a213-2299ce0c07f4',
        'x-amz-meta-lyralume-title': encode('中文标题'),
        'x-amz-meta-lyralume-artist': encode('歌手'),
        'x-amz-meta-lyralume-album': encode('专辑'),
        'x-amz-meta-lyralume-file-name': encode('歌曲.flac'),
        'x-amz-meta-lyralume-sha256': 'b'.repeat(64),
      },
    })).toMatchObject({
      title: '中文标题',
      artist: '歌手',
      album: '专辑',
      fileName: '歌曲.flac',
      sha256: 'b'.repeat(64),
    });
  });
});
