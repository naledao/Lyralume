import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { StoredTrackLocation } from '../library/types.js';
import { logger } from '../logging.js';
import { readEmbeddedLyricsAsLrc } from './kid3.js';

export type LyricsSourceKind = 'lrc' | 'embedded';

export interface LoadedLyricsSource {
  raw: string;
  fileName: string;
  source: LyricsSourceKind;
  revision: string;
}

function revisionOf(raw: string, source: LyricsSourceKind): string {
  return createHash('sha256').update(source).update('\0').update(raw).digest('hex');
}

async function readSidecar(track: StoredTrackLocation): Promise<LoadedLyricsSource | undefined> {
  if (!track.lrcPath) return undefined;
  try {
    const raw = await readFile(track.lrcPath, 'utf8');
    return {
      raw,
      fileName: track.lrcPath.split(/[\\/]/).pop() ?? '外置 LRC',
      source: 'lrc',
      revision: revisionOf(raw, 'lrc'),
    };
  } catch (error) {
    logger.warn(`Unable to read LRC for track ${track.id}`, error);
    return undefined;
  }
}

async function readEmbedded(track: StoredTrackLocation): Promise<LoadedLyricsSource | undefined> {
  try {
    const raw = await readEmbeddedLyricsAsLrc(track.filePath);
    return raw ? {
      raw,
      fileName: '内嵌同步歌词',
      source: 'embedded',
      revision: revisionOf(raw, 'embedded'),
    } : undefined;
  } catch (error) {
    logger.warn(`Unable to read embedded lyrics for track ${track.id}`, error);
    return undefined;
  }
}

export async function loadPreferredLyricsSource(
  track: StoredTrackLocation,
): Promise<LoadedLyricsSource | undefined> {
  if (track.preferEmbeddedLyrics) {
    return await readEmbedded(track) ?? await readSidecar(track);
  }
  return await readSidecar(track) ?? await readEmbedded(track);
}
