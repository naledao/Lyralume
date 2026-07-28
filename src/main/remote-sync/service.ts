import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import type {
  LibrarySnapshot,
  RemoteCatalogEntry,
  RemoteConnectionTestResult,
  RemoteMusicItem,
  RemoteMusicSnapshot,
  RemoteSyncRecord,
  Track,
} from '../../shared/contracts.js';
import type { LibraryDatabase } from '../library/database.js';
import { logger } from '../logging.js';
import type { AppSettingsService } from '../settings/app-settings.js';
import { TrackWriteBusyError, TrackWriteCoordinator } from '../track-write-coordinator.js';
import {
  createMinioGateway,
  type MinioGateway,
  type MinioGatewayFactory,
  type RemoteObjectInfo,
} from './minio-client.js';

const OBJECT_PREFIX = 'lyralume/v1/tracks/';
const RETRY_BASE_MS = 30_000;
const RETRY_MAX_MS = 15 * 60_000;

type RemoteSnapshotListener = (snapshot: RemoteMusicSnapshot) => void;

function encodeMetadata(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64url');
}

function decodeMetadata(value: string | undefined, fallback: string): string {
  if (!value) return fallback;
  try {
    return Buffer.from(value, 'base64url').toString('utf8') || fallback;
  } catch {
    return fallback;
  }
}

function metadataValue(metadata: Record<string, unknown>, name: string): string | undefined {
  const requested = name.toLocaleLowerCase();
  for (const [key, value] of Object.entries(metadata)) {
    const normalized = key.toLocaleLowerCase().replace(/^x-amz-meta-/, '');
    if (normalized !== requested) continue;
    if (Array.isArray(value)) return value.length > 0 ? String(value[0]) : undefined;
    if (value === undefined || value === null) return undefined;
    return String(value);
  }
  return undefined;
}

function syncIdFromObjectName(objectName: string): string | undefined {
  const matched = objectName.match(/^lyralume\/v1\/tracks\/([0-9a-f-]{36})\//i);
  return matched?.[1];
}

export function catalogEntryFromObject(object: RemoteObjectInfo): RemoteCatalogEntry | null {
  const syncId = metadataValue(object.metadata, 'lyralume-sync-id')
    ?? syncIdFromObjectName(object.name);
  if (!syncId) return null;
  const fallbackName = path.posix.basename(object.name);
  return {
    syncId,
    objectName: object.name,
    fileName: decodeMetadata(
      metadataValue(object.metadata, 'lyralume-file-name'),
      fallbackName,
    ),
    title: decodeMetadata(metadataValue(object.metadata, 'lyralume-title'), fallbackName),
    artist: decodeMetadata(metadataValue(object.metadata, 'lyralume-artist'), '未知艺术家'),
    album: decodeMetadata(metadataValue(object.metadata, 'lyralume-album'), '未知专辑'),
    duration: Number(metadataValue(object.metadata, 'lyralume-duration')) || 0,
    fileSize: object.size,
    lastModified: object.lastModified.getTime(),
    etag: object.etag,
    sha256: metadataValue(object.metadata, 'lyralume-sha256'),
  };
}

function objectNameFor(syncId: string, fileName: string): string {
  const extension = path.extname(fileName).toLocaleLowerCase();
  const safeExtension = /^\.[a-z0-9]{1,10}$/.test(extension) ? extension : '';
  return `${OBJECT_PREFIX}${syncId}/audio${safeExtension}`;
}

function contentTypeFor(fileName: string): string {
  return ({
    '.mp3': 'audio/mpeg',
    '.flac': 'audio/flac',
    '.m4a': 'audio/mp4',
    '.aac': 'audio/aac',
    '.wav': 'audio/wav',
    '.ogg': 'audio/ogg',
    '.opus': 'audio/ogg',
    '.wma': 'audio/x-ms-wma',
  } as Record<string, string>)[path.extname(fileName).toLocaleLowerCase()]
    ?? 'application/octet-stream';
}

async function sha256File(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const source = createReadStream(filePath);
    source.on('data', (chunk) => hash.update(chunk));
    source.once('error', reject);
    source.once('end', () => resolve(hash.digest('hex')));
  });
}

function fileStateMatches(
  left: { size: number; mtimeMs: number },
  right: { size: number; mtimeMs: number },
): boolean {
  return left.size === right.size && left.mtimeMs === right.mtimeMs;
}

export class RemoteSyncService {
  private librarySnapshot: LibrarySnapshot = { tracks: [], roots: [] };
  private listener?: RemoteSnapshotListener;
  private online = false;
  private refreshedAt?: number;
  private connectionError?: string;
  private queue = new Set<string>();
  private draining?: Promise<void>;
  private retryTimers = new Map<string, NodeJS.Timeout>();
  private closing = false;
  private configGeneration = 0;

  constructor(
    private readonly database: LibraryDatabase,
    private readonly settings: AppSettingsService,
    private readonly trackWrites: TrackWriteCoordinator,
    private readonly gatewayFactory: MinioGatewayFactory = createMinioGateway,
  ) {}

  setListener(listener: RemoteSnapshotListener): void {
    this.listener = listener;
  }

  async initialize(snapshot: LibrarySnapshot): Promise<void> {
    this.librarySnapshot = snapshot;
    for (const record of this.database.getRemoteSyncRecords()) {
      if (record.status === 'hashing' || record.status === 'uploading') {
        this.saveRecord({
          ...record,
          status: 'pending',
          progress: 0,
          error: '上次同步在应用退出时中断，已重新排队',
          updatedAt: Date.now(),
        }, false);
      }
    }
    this.reconcileLibrary();
    const configured = Boolean(await this.settings.getMinioConnection().catch(() => undefined));
    if (configured) void this.refresh();
    this.emit();
  }

  onLibraryChanged(snapshot: LibrarySnapshot): void {
    this.librarySnapshot = snapshot;
    this.reconcileLibrary();
    if (this.settings.isMinioAutoSyncEnabled()) this.enqueueDirtyTracks();
    this.emit();
  }

  async onSettingsChanged(): Promise<RemoteMusicSnapshot> {
    this.configGeneration += 1;
    this.online = false;
    this.connectionError = undefined;
    this.refreshedAt = undefined;
    this.database.replaceRemoteMusicCache([], Date.now());
    for (const timer of this.retryTimers.values()) clearTimeout(timer);
    this.retryTimers.clear();
    const connection = await this.settings.getMinioConnection().catch(() => undefined);
    if (connection) void this.refresh();
    this.emit();
    return this.getSnapshot();
  }

  async getSnapshot(): Promise<RemoteMusicSnapshot> {
    const settings = await this.settings.getSnapshot();
    const tracks = new Map(this.librarySnapshot.tracks.map((track) => [track.id, track]));
    const records = this.database.getRemoteSyncRecords();
    const recordsBySyncId = new Map(records.map((record) => [record.syncId, record]));
    const cached = this.database.getRemoteMusicCache();
    const remoteSyncIds = new Set(cached.map((entry) => entry.syncId));
    const items: RemoteMusicItem[] = cached.map((entry) => {
      const record = recordsBySyncId.get(entry.syncId);
      const track = record ? tracks.get(record.trackId) : undefined;
      let syncStatus: RemoteMusicItem['syncStatus'] = 'remote_only';
      if (track && record) {
        if (record.status === 'synced') {
          syncStatus = record.localSha256 && entry.sha256 === record.localSha256
            ? 'synced'
            : 'local_changed';
        } else syncStatus = record.status;
      }
      return {
        ...entry,
        localTrackId: track?.id,
        syncStatus,
        progress: record?.progress ?? 0,
        error: record?.error,
      };
    });

    for (const track of tracks.values()) {
      const record = this.database.getRemoteSyncRecord(track.id);
      if (record && remoteSyncIds.has(record.syncId)) continue;
      items.push({
        syncId: record?.syncId ?? track.id,
        objectName: record?.objectName ?? '',
        fileName: track.fileName,
        title: track.title,
        artist: track.artist,
        album: track.album,
        duration: track.duration,
        fileSize: track.fileSize,
        lastModified: 0,
        etag: record?.remoteEtag ?? '',
        sha256: record?.localSha256,
        localTrackId: track.id,
        syncStatus: record
          ? record.status === 'synced' ? 'local_changed' : record.status
          : 'local_only',
        progress: record?.progress ?? 0,
        error: record?.error,
      });
    }

    items.sort((left, right) => (
      left.title.localeCompare(right.title, 'zh-CN')
      || left.artist.localeCompare(right.artist, 'zh-CN')
    ));
    return {
      configured: settings.minioConfigured,
      online: settings.minioConfigured && this.online,
      autoSync: settings.minioAutoSync,
      items,
      refreshedAt: this.refreshedAt,
      error: this.connectionError,
    };
  }

  async testConnection(): Promise<RemoteConnectionTestResult> {
    const connection = await this.requireConnection();
    const gateway = this.gatewayFactory(connection);
    try {
      const created = await this.ensureBucket(gateway, connection.bucket);
      return {
        ok: true,
        endpoint: connection.endpoint,
        bucket: connection.bucket,
        message: created
          ? `MinIO 连接成功，已自动创建 Bucket “${connection.bucket}”`
          : 'MinIO 连接成功，Bucket 可访问',
      };
    } catch (error) {
      throw new Error(this.safeError(error, connection.endpoint, connection.accessKey, connection.secretKey));
    }
  }

  async refresh(): Promise<RemoteMusicSnapshot> {
    let connection;
    try {
      connection = await this.requireConnection();
      const gateway = this.gatewayFactory(connection);
      await this.ensureBucket(gateway, connection.bucket);
      const entries = (await gateway.listObjects(connection.bucket, OBJECT_PREFIX))
        .map(catalogEntryFromObject)
        .filter((entry): entry is RemoteCatalogEntry => Boolean(entry));
      const refreshedAt = Date.now();
      this.database.replaceRemoteMusicCache(entries, refreshedAt);
      this.refreshedAt = refreshedAt;
      this.online = true;
      this.connectionError = undefined;
    } catch (error) {
      this.online = false;
      this.connectionError = this.safeError(
        error,
        connection?.endpoint,
        connection?.accessKey,
        connection?.secretKey,
      );
    }
    if (this.settings.isMinioAutoSyncEnabled()) this.enqueueDirtyTracks();
    this.emit();
    return this.getSnapshot();
  }

  async syncAll(): Promise<RemoteMusicSnapshot> {
    await this.requireConnection();
    for (const track of this.librarySnapshot.tracks) this.enqueue(track.id);
    return this.getSnapshot();
  }

  async syncTrack(trackId: string): Promise<RemoteMusicSnapshot> {
    if (!this.librarySnapshot.tracks.some((track) => track.id === trackId)) {
      throw new Error('音乐库中找不到这首歌曲');
    }
    await this.requireConnection();
    this.enqueue(trackId);
    return this.getSnapshot();
  }

  async close(): Promise<void> {
    this.closing = true;
    this.queue.clear();
    for (const timer of this.retryTimers.values()) clearTimeout(timer);
    this.retryTimers.clear();
    await this.draining?.catch(() => undefined);
  }

  private reconcileLibrary(): void {
    for (const track of this.librarySnapshot.tracks) {
      const record = this.database.getRemoteSyncRecord(track.id);
      if (!record) continue;
      if (
        record.localSize !== track.fileSize
        || record.localModifiedAt !== track.modifiedAt
      ) {
        this.saveRecord({
          ...record,
          status: 'pending',
          progress: 0,
          localSize: track.fileSize,
          localModifiedAt: track.modifiedAt,
          error: undefined,
          updatedAt: Date.now(),
        }, false);
      }
    }
  }

  private enqueueDirtyTracks(): void {
    const remoteSyncIds = new Set(this.database.getRemoteMusicCache().map((entry) => entry.syncId));
    for (const track of this.librarySnapshot.tracks) {
      const record = this.database.getRemoteSyncRecord(track.id);
      if (
        !record
        || record.status !== 'synced'
        || record.localSize !== track.fileSize
        || record.localModifiedAt !== track.modifiedAt
        || !remoteSyncIds.has(record.syncId)
      ) this.enqueue(track.id);
    }
  }

  private enqueue(trackId: string): void {
    if (this.closing) return;
    const timer = this.retryTimers.get(trackId);
    if (timer) clearTimeout(timer);
    this.retryTimers.delete(trackId);
    this.queue.add(trackId);
    if (!this.draining) {
      this.draining = this.drain().finally(() => {
        this.draining = undefined;
        if (this.queue.size > 0 && !this.closing) this.enqueue([...this.queue][0]);
      });
    }
  }

  private async drain(): Promise<void> {
    while (this.queue.size > 0 && !this.closing) {
      const trackId = this.queue.values().next().value as string | undefined;
      if (!trackId) return;
      this.queue.delete(trackId);
      await this.syncOne(trackId);
    }
  }

  private async syncOne(trackId: string): Promise<void> {
    const track = this.librarySnapshot.tracks.find((item) => item.id === trackId);
    const location = this.database.getTrackLocation(trackId);
    if (!track || !location) return;
    let record = this.database.getRemoteSyncRecord(trackId) ?? {
      trackId,
      syncId: randomUUID(),
      status: 'pending' as const,
      progress: 0,
      localSize: track.fileSize,
      localModifiedAt: track.modifiedAt,
      retryCount: 0,
      updatedAt: Date.now(),
    };
    this.saveRecord(record);
    let connection;
    try {
      connection = await this.requireConnection();
      const generation = this.configGeneration;
      const gateway = this.gatewayFactory(connection);
      await this.ensureBucket(gateway, connection.bucket);
      await this.trackWrites.run(trackId, async () => {
        const before = await stat(location.filePath);
        record = this.patchRecord(record, {
          status: 'hashing',
          progress: 0.05,
          localSize: before.size,
          localModifiedAt: before.mtimeMs,
          error: undefined,
        });
        const sha256 = await sha256File(location.filePath);
        const afterHash = await stat(location.filePath);
        if (!fileStateMatches(before, afterHash)) {
          throw new Error('歌曲在计算校验值时发生变化，已等待下一次同步');
        }

        record = this.reuseIdentityForHash(record, sha256);
        const objectName = record.objectName || objectNameFor(record.syncId, track.fileName);
        const cached = this.database.getRemoteMusicCache()
          .find((entry) => entry.syncId === record.syncId);
        if (record.localSha256 === sha256 && cached?.sha256 === sha256) {
          record = this.patchRecord(record, {
            objectName: cached.objectName,
            status: 'synced',
            progress: 1,
            localSize: afterHash.size,
            localModifiedAt: afterHash.mtimeMs,
            remoteEtag: cached.etag,
            syncedAt: record.syncedAt ?? Date.now(),
            retryCount: 0,
            error: undefined,
          });
          return;
        }

        record = this.patchRecord(record, {
          objectName,
          status: 'uploading',
          progress: 0.2,
          localSha256: sha256,
          error: undefined,
        });
        await gateway.putFile(
          connection!.bucket,
          objectName,
          location.filePath,
          this.objectMetadata(track, record.syncId, sha256),
        );
        const [afterUpload, remote] = await Promise.all([
          stat(location.filePath),
          gateway.statObject(connection!.bucket, objectName),
        ]);
        if (!fileStateMatches(before, afterUpload)) {
          throw new Error('歌曲在上传期间发生变化，已等待重新同步');
        }
        const remoteEntry = catalogEntryFromObject(remote);
        if (
          !remoteEntry
          || remoteEntry.fileSize !== afterUpload.size
          || remoteEntry.sha256 !== sha256
        ) throw new Error('MinIO 上传后回读验证失败');
        if (generation !== this.configGeneration) {
          throw new Error('MinIO 设置在上传期间发生变化，请重新同步');
        }
        const now = Date.now();
        this.database.saveRemoteMusicCacheEntry(remoteEntry, now);
        this.refreshedAt = now;
        this.online = true;
        this.connectionError = undefined;
        record = this.patchRecord(record, {
          status: 'synced',
          progress: 1,
          localSize: afterUpload.size,
          localModifiedAt: afterUpload.mtimeMs,
          localSha256: sha256,
          remoteEtag: remote.etag,
          syncedAt: now,
          retryCount: 0,
          error: undefined,
        });
        logger.info(`[remote-sync:${record.syncId}] Uploaded and verified ${track.fileName}`);
      });
    } catch (error) {
      const message = error instanceof TrackWriteBusyError
        ? '歌曲文件正在执行其他任务，稍后重试同步'
        : this.safeError(
          error,
          connection?.endpoint,
          connection?.accessKey,
          connection?.secretKey,
        );
      record = this.patchRecord(record, {
        status: error instanceof TrackWriteBusyError ? 'pending' : 'failed',
        progress: 0,
        retryCount: record.retryCount + 1,
        error: message,
      });
      logger.warn(`[remote-sync:${record.syncId}] ${message}`);
      if (this.settings.isMinioAutoSyncEnabled()) this.scheduleRetry(trackId, record.retryCount);
    }
  }

  private reuseIdentityForHash(record: RemoteSyncRecord, sha256: string): RemoteSyncRecord {
    const activeTrackIds = new Set(this.librarySnapshot.tracks.map((track) => track.id));
    const records = this.database.getRemoteSyncRecords();
    const previous = records.find((candidate) => (
      candidate.trackId !== record.trackId
      && !activeTrackIds.has(candidate.trackId)
      && candidate.localSha256 === sha256
    ));
    const remote = this.database.getRemoteMusicCache().find((entry) => (
      entry.sha256 === sha256
      && !records.some((candidate) => (
        candidate.trackId !== record.trackId
        && activeTrackIds.has(candidate.trackId)
        && candidate.syncId === entry.syncId
      ))
    ));
    if (previous) this.database.deleteRemoteSyncRecord(previous.trackId);
    if (!previous && !remote) return record;
    const next: RemoteSyncRecord = {
      ...(previous ?? record),
      trackId: record.trackId,
      syncId: previous?.syncId ?? remote!.syncId,
      objectName: previous?.objectName ?? remote?.objectName,
      status: 'hashing',
      progress: record.progress,
      localSize: record.localSize,
      localModifiedAt: record.localModifiedAt,
      retryCount: record.retryCount,
      error: undefined,
      updatedAt: Date.now(),
    };
    this.saveRecord(next);
    return next;
  }

  private objectMetadata(
    track: Track,
    syncId: string,
    sha256: string,
  ): Record<string, string> {
    return {
      'Content-Type': contentTypeFor(track.fileName),
      'X-Amz-Meta-Lyralume-Schema': '1',
      'X-Amz-Meta-Lyralume-Sync-Id': syncId,
      'X-Amz-Meta-Lyralume-Sha256': sha256,
      'X-Amz-Meta-Lyralume-File-Name': encodeMetadata(track.fileName),
      'X-Amz-Meta-Lyralume-Title': encodeMetadata(track.title),
      'X-Amz-Meta-Lyralume-Artist': encodeMetadata(track.artist),
      'X-Amz-Meta-Lyralume-Album': encodeMetadata(track.album),
      'X-Amz-Meta-Lyralume-Duration': String(track.duration),
    };
  }

  private patchRecord(
    record: RemoteSyncRecord,
    patch: Partial<RemoteSyncRecord>,
  ): RemoteSyncRecord {
    const next = { ...record, ...patch, updatedAt: Date.now() };
    this.saveRecord(next);
    return next;
  }

  private saveRecord(record: RemoteSyncRecord, emit = true): void {
    this.database.saveRemoteSyncRecord(record);
    if (emit) this.emit();
  }

  private scheduleRetry(trackId: string, retryCount: number): void {
    if (this.closing || this.retryTimers.has(trackId)) return;
    const delay = Math.min(RETRY_MAX_MS, RETRY_BASE_MS * (2 ** Math.max(0, retryCount - 1)));
    const timer = setTimeout(() => {
      this.retryTimers.delete(trackId);
      this.enqueue(trackId);
    }, delay);
    timer.unref();
    this.retryTimers.set(trackId, timer);
  }

  private async requireConnection() {
    const connection = await this.settings.getMinioConnection();
    if (!connection) throw new Error('请先在设置中配置 MinIO');
    return connection;
  }

  private async ensureBucket(gateway: MinioGateway, bucket: string): Promise<boolean> {
    if (await gateway.bucketExists(bucket)) return false;
    try {
      await gateway.makeBucket(bucket);
      logger.info(`[remote-sync] Created MinIO bucket ${bucket}`);
      return true;
    } catch (error) {
      // Another request or client may have created it after our existence check.
      if (await gateway.bucketExists(bucket).catch(() => false)) return false;
      const reason = error instanceof Error ? error.message : '未知错误';
      throw new Error(`Bucket “${bucket}”不存在且自动创建失败：${reason}`);
    }
  }

  private safeError(
    error: unknown,
    endpoint?: string,
    accessKey?: string,
    secretKey?: string,
  ): string {
    let message = error instanceof Error ? error.message : 'MinIO 请求失败';
    for (const value of [endpoint, accessKey, secretKey]) {
      if (value) message = message.replaceAll(value, '<redacted>');
    }
    return message || 'MinIO 请求失败';
  }

  private emit(): void {
    if (!this.listener) return;
    void this.getSnapshot()
      .then((snapshot) => this.listener?.(snapshot))
      .catch((error) => logger.warn('Unable to build remote music snapshot', error));
  }
}
