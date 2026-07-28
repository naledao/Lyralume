import path from 'node:path';
import { Converter } from 'opencc-js/t2cn';
import type { SimplifiedLyricsWriteResult } from '../../shared/contracts.js';
import { parseLrc } from '../../shared/lrc.js';
import { LibraryDatabase } from '../library/database.js';
import { LibraryService } from '../library/service.js';
import { TrackWriteCoordinator } from '../track-write-coordinator.js';
import { Kid3Adapter } from './kid3.js';
import { applyOffsetForEmbedding } from './lyrics-offset-service.js';
import { loadPreferredLyricsSource } from './lyrics-source.js';

const convertTraditionalToSimplified = Converter({ from: 't', to: 'cn' });

export class SimplifiedLyricsError extends Error {
  constructor(
    readonly kind:
      | 'track_not_found'
      | 'unsupported_format'
      | 'lyrics_missing'
      | 'source_changed',
    message: string,
  ) {
    super(message);
    this.name = 'SimplifiedLyricsError';
  }
}

export interface SimplifiedLyricsConversion {
  raw: string;
  lineCount: number;
  changedLineCount: number;
}

/**
 * Bake the currently previewed offset into the timestamps, then convert only
 * the resulting synchronized lyric document to Mainland simplified Chinese.
 */
export function simplifyLyricsForEmbedding(
  raw: string,
  offsetMs: number,
): SimplifiedLyricsConversion {
  const adjusted = applyOffsetForEmbedding(raw, offsetMs);
  const before = parseLrc(adjusted).lines;
  const simplified = convertTraditionalToSimplified(adjusted);
  const after = parseLrc(simplified).lines;
  const changedLineCount = before.reduce(
    (count, line, index) => count + (line.text === after[index]?.text ? 0 : 1),
    0,
  );
  return {
    raw: simplified,
    lineCount: after.length,
    changedLineCount,
  };
}

export class SimplifiedLyricsService {
  constructor(
    private readonly database: LibraryDatabase,
    private readonly library: LibraryService,
    private readonly kid3: Pick<Kid3Adapter, 'writeLyricsAndVerify'>,
    private readonly trackWrites: TrackWriteCoordinator,
  ) {}

  async write(
    trackId: string,
    offsetMs: number,
    expectedRevision: string,
  ): Promise<SimplifiedLyricsWriteResult> {
    const track = this.database.getTrackLocation(trackId);
    if (!track) throw new SimplifiedLyricsError('track_not_found', '音乐库中找不到这首歌曲');
    if (path.extname(track.filePath).toLocaleLowerCase() !== '.mp3') {
      throw new SimplifiedLyricsError('unsupported_format', '简体歌词写入目前仅支持 MP3 文件');
    }

    const source = await loadPreferredLyricsSource(track);
    if (!source) throw new SimplifiedLyricsError('lyrics_missing', '找不到可转换的同步歌词');
    if (source.revision !== expectedRevision) {
      throw new SimplifiedLyricsError('source_changed', '歌词来源已经改变，请重新载入后再转换');
    }

    const converted = simplifyLyricsForEmbedding(source.raw, offsetMs);
    await this.trackWrites.run(
      trackId,
      () => this.kid3.writeLyricsAndVerify(
        track.filePath,
        converted.raw,
        'Lyralume / Simplified zh-CN',
      ),
    );

    this.database.setTrackEmbeddedLyrics(trackId, true);
    this.database.setTrackPreferEmbeddedLyrics(trackId, true);
    this.library.refreshSnapshot();
    return {
      appliedOffsetMs: offsetMs,
      lineCount: converted.lineCount,
      changedLineCount: converted.changedLineCount,
      source: source.source,
    };
  }
}
