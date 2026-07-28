import { createHash } from 'node:crypto';
import { access, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { parseFile, type IAudioMetadata } from 'music-metadata';
import {
  normalizeTrackLanguage,
  UNKNOWN_ALBUM,
  UNKNOWN_ARTIST,
  type ScanProgress,
  type ScanWarning,
} from '../../shared/contracts.js';
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

export type UnsynchronizedLyricsMigrator = (
  audioPath: string,
  lyricsText: string,
) => Promise<void>;

export interface ScanDependencies {
  migrateUnsynchronizedLyrics?: UnsynchronizedLyricsMigrator;
  rejectUnconvertedTextLyrics?: boolean;
  readMetadata?: (audioPath: string) => Promise<IAudioMetadata>;
}

export function trackIdForPath(filePath: string): string {
  return createHash('sha256').update(filePath.toLocaleLowerCase()).digest('hex').slice(0, 24);
}

function hasSynchronizedLyrics(frame: {
  syncText?: Array<{ text: string; timestamp?: number }>;
}): boolean {
  return (frame.syncText?.length ?? 0) > 0;
}

function unsynchronizedLyricsText(metadata: IAudioMetadata): string | undefined {
  const frames = metadata.common.lyrics ?? [];
  const textFrames = frames.filter((frame) => (
    !hasSynchronizedLyrics(frame)
    && typeof frame.text === 'string'
    && frame.text.trim().length > 0
  ));
  if (textFrames.length > 0 && frames.some(hasSynchronizedLyrics)) {
    throw new Error('歌曲同时包含 text 和 syncText 歌词，为避免覆盖已有同步歌词而拒绝导入');
  }
  if (textFrames.length > 1) {
    throw new Error('检测到多个内嵌 text 歌词标签，无法安全确定要转换的内容');
  }
  return textFrames[0]?.text;
}

async function collectAudioFiles(rootPath: string): Promise<string[]> {
  const rootStat = await stat(rootPath);
  if (rootStat.isFile()) {
    return AUDIO_CANDIDATE_EXTENSIONS.has(path.extname(rootPath).toLowerCase()) ? [rootPath] : [];
  }
  if (!rootStat.isDirectory()) return [];

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
  dependencies: ScanDependencies = {},
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
      const readMetadata = dependencies.readMetadata
        ?? ((audioPath: string) => parseFile(audioPath, { duration: true, skipPostHeaders: true }));
      let [metadata, fileStat, lrcPath] = await Promise.all([
        readMetadata(filePath),
        stat(filePath),
        findSidecarLrc(filePath),
      ]);
      const embeddedText = path.extname(filePath).toLowerCase() === '.mp3'
        && (dependencies.migrateUnsynchronizedLyrics || dependencies.rejectUnconvertedTextLyrics)
        ? unsynchronizedLyricsText(metadata)
        : undefined;
      if (embeddedText !== undefined) {
        if (!dependencies.migrateUnsynchronizedLyrics && dependencies.rejectUnconvertedTextLyrics) {
          throw new Error('内嵌 text 歌词需要转换为 syncText，但歌词标签转换器不可用');
        }
        if (dependencies.migrateUnsynchronizedLyrics) {
          await dependencies.migrateUnsynchronizedLyrics(filePath, embeddedText);
          metadata = await readMetadata(filePath);
          if (unsynchronizedLyricsText(metadata) !== undefined) {
            throw new Error('内嵌 text 歌词转换后仍然存在');
          }
          if (!metadata.common.lyrics?.some(hasSynchronizedLyrics)) {
            throw new Error('内嵌 text 歌词未能转换为有效的 syncText');
          }
          fileStat = await stat(filePath);
        }
      }
      if (!metadata.format.container && !metadata.format.codec && !metadata.format.duration) {
        throw new Error('无法识别音频容器或编码');
      }
      const artwork = metadata.common.picture?.[0];
      const baseName = path.parse(filePath).name;
      tracks.push({
        id: trackIdForPath(filePath),
        rootPath,
        filePath,
        fileName: path.basename(filePath),
        title: metadata.common.title?.trim() || baseName,
        artist: metadata.common.artist?.trim() || UNKNOWN_ARTIST,
        album: metadata.common.album?.trim() || UNKNOWN_ALBUM,
        language: normalizeTrackLanguage(metadata.common.language),
        duration: Number.isFinite(metadata.format.duration) ? metadata.format.duration ?? 0 : 0,
        fileSize: fileStat.size,
        modifiedAt: fileStat.mtimeMs,
        lrcPath,
        hasEmbeddedLyrics: Boolean(metadata.common.lyrics?.some(hasSynchronizedLyrics)),
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

export function isAudioCandidateFile(filePath: string): boolean {
  return AUDIO_CANDIDATE_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}
