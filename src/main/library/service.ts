import { stat } from 'node:fs/promises';
import { basename, extname } from 'node:path';
import { watch, type FSWatcher } from 'chokidar';
import type {
  LibrarySnapshot,
  ScanProgress,
  ScanResult,
  ScanWarning,
  TrackMetadataUpdate,
} from '../../shared/contracts.js';
import { isTrackLanguage } from '../../shared/contracts.js';
import { logger } from '../logging.js';
import { TrackWriteCoordinator } from '../track-write-coordinator.js';
import { LibraryDatabase } from './database.js';
import { isAudioCandidateFile, isLibraryFile, scanRoot } from './scanner.js';

type SnapshotListener = (snapshot: LibrarySnapshot) => void;
type ProgressListener = (progress: ScanProgress) => void;

export interface TrackMetadataWriter {
  writeMetadataAndVerify(audioPath: string, metadata: TrackMetadataUpdate): Promise<void>;
}

function cleanMetadataField(value: string, label: string): string {
  if (/\0|[\r\n]/.test(value)) throw new Error(`${label}包含不支持的控制字符`);
  const cleaned = value.trim();
  if (cleaned.length > 300) throw new Error(`${label}不能超过 300 个字符`);
  return cleaned;
}

export class LibraryService {
  private readonly watchers = new Map<string, FSWatcher>();
  private readonly debounceTimers = new Map<string, NodeJS.Timeout>();
  private scanQueue: Promise<unknown> = Promise.resolve();
  private snapshotListener?: SnapshotListener;
  private progressListener?: ProgressListener;

  constructor(
    private readonly database: LibraryDatabase,
    private readonly metadataWriter?: TrackMetadataWriter,
    private readonly trackWrites = new TrackWriteCoordinator(),
  ) {}

  setListeners(onSnapshot: SnapshotListener, onProgress: ProgressListener): void {
    this.snapshotListener = onSnapshot;
    this.progressListener = onProgress;
  }

  getSnapshot(): LibrarySnapshot {
    return this.database.getSnapshot();
  }

  refreshSnapshot(): LibrarySnapshot {
    const snapshot = this.database.getSnapshot();
    this.snapshotListener?.(snapshot);
    return snapshot;
  }

  async initializeWatchers(): Promise<void> {
    for (const root of this.database.getRoots()) this.watchRoot(root.path);
  }

  addAndScan(rootPath: string): Promise<ScanResult> {
    this.database.clearIgnoredForImport(rootPath);
    this.database.addRoot(rootPath);
    this.watchRoot(rootPath);
    return this.enqueueScan([rootPath]);
  }

  async addAndScanDropped(droppedPaths: string[]): Promise<ScanResult> {
    logger.info(`Received ${droppedPaths.length} dropped path(s) for import`);
    const warnings: ScanWarning[] = [];
    const existing = new Set(this.database.getRoots().map((root) => root.path.toLocaleLowerCase()));
    const roots: string[] = [];

    for (const droppedPath of droppedPaths) {
      const key = droppedPath.toLocaleLowerCase();
      if (existing.has(key)) {
        this.database.clearIgnoredForImport(droppedPath);
        roots.push(droppedPath);
        continue;
      }
      try {
        const droppedStat = await stat(droppedPath);
        if (!droppedStat.isDirectory() && !(droppedStat.isFile() && isAudioCandidateFile(droppedPath))) {
          warnings.push({ fileName: basename(droppedPath), message: '不是受支持的音乐文件或文件夹' });
          continue;
        }
        existing.add(key);
        roots.push(droppedPath);
        this.database.clearIgnoredForImport(droppedPath);
        this.database.addRoot(droppedPath);
        this.watchRoot(droppedPath);
      } catch (error) {
        warnings.push({
          fileName: basename(droppedPath),
          message: error instanceof Error ? error.message : '拖入项目无法访问',
        });
      }
    }

    if (roots.length === 0) {
      return {
        ...this.database.getSnapshot(),
        scannedFiles: 0,
        importedTracks: 0,
        warnings,
      };
    }
    const result = await this.enqueueScan(roots);
    return { ...result, warnings: [...warnings, ...result.warnings] };
  }

  rescanAll(): Promise<ScanResult> {
    return this.enqueueScan(this.database.getRoots().map((root) => root.path));
  }

  removeTrack(trackId: string): Promise<LibrarySnapshot> {
    const next = this.scanQueue.then(async () => {
      const removed = this.database.removeTrack(trackId);
      if (removed?.rootRemoved) await this.unwatchRoot(removed.rootPath);
      return this.refreshSnapshot();
    });
    this.scanQueue = next.catch(() => undefined);
    return next;
  }

  updateTrackMetadata(trackId: string, metadata: TrackMetadataUpdate): Promise<LibrarySnapshot> {
    const normalized: TrackMetadataUpdate = {};
    const labels = { title: '歌曲名', artist: '艺术家', album: '专辑' } as const;
    for (const field of ['title', 'artist', 'album'] as const) {
      const value = metadata[field];
      if (value !== undefined) normalized[field] = cleanMetadataField(value, labels[field]);
    }
    if (metadata.language !== undefined) {
      if (metadata.language !== '' && !isTrackLanguage(metadata.language)) {
        throw new Error('不支持的歌曲语种');
      }
      normalized.language = metadata.language;
    }
    if (Object.keys(normalized).length === 0) throw new Error('没有需要保存的歌曲信息');
    const next = this.scanQueue.then(async () => {
      const track = this.database.getTrackLocation(trackId);
      if (!track) throw new Error('音乐库中找不到这首歌曲');
      const sourceMetadata: TrackMetadataUpdate = { ...normalized };
      const writesMp3Language = extname(track.filePath).toLocaleLowerCase() === '.mp3';
      if (!writesMp3Language) delete sourceMetadata.language;
      if (Object.keys(sourceMetadata).length > 0) {
        if (!this.metadataWriter) throw new Error('歌曲标签写入功能尚未配置');
        await this.trackWrites.run(
          trackId,
          () => this.metadataWriter!.writeMetadataAndVerify(track.filePath, sourceMetadata),
        );
      }
      if (!this.database.setTrackMetadata(trackId, normalized)) {
        throw new Error('音乐库中找不到这首歌曲');
      }
      logger.info(
        Object.keys(sourceMetadata).length > 0
          ? `[track:${trackId}] Wrote ${Object.keys(sourceMetadata).join(', ')} to the source audio file and verified it`
          : `[track:${trackId}] Saved ${Object.keys(normalized).join(', ')} to the local library`,
      );
      return this.refreshSnapshot();
    });
    this.scanQueue = next.catch(() => undefined);
    return next;
  }

  private enqueueScan(rootPaths: string[]): Promise<ScanResult> {
    const next = this.scanQueue.then(() => this.performScan(rootPaths));
    this.scanQueue = next.catch(() => undefined);
    return next;
  }

  private async performScan(rootPaths: string[]): Promise<ScanResult> {
    const warnings: ScanWarning[] = [];
    let scannedFiles = 0;
    let importedTracks = 0;

    for (const rootPath of rootPaths) {
      try {
        logger.info(`Scanning library root: ${rootPath}`);
        const result = await scanRoot(rootPath, (progress) => this.progressListener?.(progress));
        this.database.syncRoot(rootPath, result.tracks, result.discoveredPaths);
        scannedFiles += result.discoveredPaths.size;
        importedTracks += result.tracks.length;
        warnings.push(...result.warnings);
      } catch (error) {
        logger.error(`Library scan failed for ${rootPath}`, error);
        warnings.push({
          fileName: basename(rootPath),
          message: error instanceof Error ? error.message : '目录扫描失败',
        });
      }
    }

    this.progressListener?.({
      rootPath: rootPaths.at(-1) ?? '',
      processed: scannedFiles,
      total: scannedFiles,
      completed: true,
    });
    const snapshot = this.database.getSnapshot();
    this.snapshotListener?.(snapshot);
    return { ...snapshot, scannedFiles, importedTracks, warnings };
  }

  private watchRoot(rootPath: string): void {
    if (this.watchers.has(rootPath)) return;
    const watcher = watch(rootPath, {
      ignoreInitial: true,
      persistent: true,
      awaitWriteFinish: { stabilityThreshold: 900, pollInterval: 100 },
    });
    const schedule = (filePath: string): void => {
      if (!isLibraryFile(filePath)) return;
      const existing = this.debounceTimers.get(rootPath);
      if (existing) clearTimeout(existing);
      this.debounceTimers.set(
        rootPath,
        setTimeout(() => {
          this.debounceTimers.delete(rootPath);
          void this.enqueueScan([rootPath]);
        }, 700),
      );
    };
    watcher.on('add', schedule).on('change', schedule).on('unlink', schedule);
    watcher.on('error', (error) => logger.warn(`Watcher error for ${rootPath}`, error));
    this.watchers.set(rootPath, watcher);
  }

  private async unwatchRoot(rootPath: string): Promise<void> {
    const timer = this.debounceTimers.get(rootPath);
    if (timer) clearTimeout(timer);
    this.debounceTimers.delete(rootPath);
    const watcher = this.watchers.get(rootPath);
    this.watchers.delete(rootPath);
    await watcher?.close();
  }

  async close(): Promise<void> {
    for (const timer of this.debounceTimers.values()) clearTimeout(timer);
    this.debounceTimers.clear();
    await Promise.all([...this.watchers.values()].map((watcher) => watcher.close()));
    this.watchers.clear();
  }
}
