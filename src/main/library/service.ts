import { basename } from 'node:path';
import { watch, type FSWatcher } from 'chokidar';
import type {
  LibrarySnapshot,
  ScanProgress,
  ScanResult,
  ScanWarning,
} from '../../shared/contracts.js';
import { logger } from '../logging.js';
import { LibraryDatabase } from './database.js';
import { isLibraryFile, scanRoot } from './scanner.js';

type SnapshotListener = (snapshot: LibrarySnapshot) => void;
type ProgressListener = (progress: ScanProgress) => void;

export class LibraryService {
  private readonly watchers = new Map<string, FSWatcher>();
  private readonly debounceTimers = new Map<string, NodeJS.Timeout>();
  private scanQueue: Promise<unknown> = Promise.resolve();
  private snapshotListener?: SnapshotListener;
  private progressListener?: ProgressListener;

  constructor(private readonly database: LibraryDatabase) {}

  setListeners(onSnapshot: SnapshotListener, onProgress: ProgressListener): void {
    this.snapshotListener = onSnapshot;
    this.progressListener = onProgress;
  }

  getSnapshot(): LibrarySnapshot {
    return this.database.getSnapshot();
  }

  async initializeWatchers(): Promise<void> {
    for (const root of this.database.getRoots()) this.watchRoot(root.path);
  }

  addAndScan(rootPath: string): Promise<ScanResult> {
    this.database.addRoot(rootPath);
    this.watchRoot(rootPath);
    return this.enqueueScan([rootPath]);
  }

  rescanAll(): Promise<ScanResult> {
    return this.enqueueScan(this.database.getRoots().map((root) => root.path));
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

  async close(): Promise<void> {
    for (const timer of this.debounceTimers.values()) clearTimeout(timer);
    this.debounceTimers.clear();
    await Promise.all([...this.watchers.values()].map((watcher) => watcher.close()));
    this.watchers.clear();
  }
}
