import { createHash } from 'node:crypto';
import { access, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { parseFile } from 'music-metadata';
import type { ScanProgress, ScanWarning } from '../../shared/contracts.js';
import type { ScannedTrack } from './types.js';

// These are scan candidates, not a claim that every codec/container is playable.
export const AUDIO_CANDIDATE_EXTENSIONS = new Set([
  '.mp3',
  '.flac',
  '.m4a',
  '.aac',
  '.wav',
  '.ogg',
  '.opus',
  '.wma',
]);

export interface RootScan {
  tracks: ScannedTrack[];
  discoveredPaths: Set<string>;
  warnings: ScanWarning[];
}

export type ProgressCallback = (progress: ScanProgress) => void;

function trackId(filePath: string): string {
  return createHash('sha256').update(filePath.toLocaleLowerCase()).digest('hex').slice(0, 24);
}

async function collectAudioFiles(rootPath: string): Promise<string[]> {
  const files: string[] = [];
  const pending = [rootPath];

  while (pending.length > 0) {
    const directory = pending.pop();
    if (!directory) continue;
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) pending.push(entryPath);
      if (entry.isFile() && AUDIO_CANDIDATE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
        files.push(entryPath);
      }
    }
  }
  return files.sort((a, b) => a.localeCompare(b));
}

async function findSidecarLrc(filePath: string): Promise<string | null> {
  const candidate = path.join(path.dirname(filePath), `${path.parse(filePath).name}.lrc`);
  try {
    await access(candidate);
    return candidate;
  } catch {
    return null;
  }
}

export async function scanRoot(
  rootPath: string,
  onProgress?: ProgressCallback,
): Promise<RootScan> {
  const filePaths = await collectAudioFiles(rootPath);
  const discoveredPaths = new Set(filePaths);
  const tracks: ScannedTrack[] = [];
  const warnings: ScanWarning[] = [];

  for (let index = 0; index < filePaths.length; index += 1) {
    const filePath = filePaths[index];
    onProgress?.({
      rootPath,
      processed: index,
      total: filePaths.length,
      currentFile: path.basename(filePath),
    });

    try {
      const [metadata, fileStat, lrcPath] = await Promise.all([
        parseFile(filePath, { duration: true, skipPostHeaders: true }),
        stat(filePath),
        findSidecarLrc(filePath),
      ]);
      if (!metadata.format.container && !metadata.format.codec && !metadata.format.duration) {
        throw new Error('无法识别音频容器或编码');
      }
      const artwork = metadata.common.picture?.[0];
      const baseName = path.parse(filePath).name;
      tracks.push({
        id: trackId(filePath),
        rootPath,
        filePath,
        fileName: path.basename(filePath),
        title: metadata.common.title?.trim() || baseName,
        artist: metadata.common.artist?.trim() || '未知艺术家',
        album: metadata.common.album?.trim() || '未知专辑',
        duration: Number.isFinite(metadata.format.duration) ? metadata.format.duration ?? 0 : 0,
        fileSize: fileStat.size,
        modifiedAt: fileStat.mtimeMs,
        lrcPath,
        artworkMime: artwork?.format ?? null,
        artwork: artwork?.data ? Buffer.from(artwork.data) : null,
      });
    } catch (error) {
      warnings.push({
        fileName: path.basename(filePath),
        message: error instanceof Error ? error.message : '无法读取音频元数据',
      });
    }
  }

  onProgress?.({ rootPath, processed: filePaths.length, total: filePaths.length });
  return { tracks, discoveredPaths, warnings };
}

export function isLibraryFile(filePath: string): boolean {
  const extension = path.extname(filePath).toLowerCase();
  return extension === '.lrc' || AUDIO_CANDIDATE_EXTENSIONS.has(extension);
}
