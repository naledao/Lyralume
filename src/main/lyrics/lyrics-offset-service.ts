import type { LyricsTimingWriteResult } from '../../shared/contracts.js';
import { parseLrc } from '../../shared/lrc.js';
import { LibraryDatabase } from '../library/database.js';
import { LibraryService } from '../library/service.js';
import { TrackWriteCoordinator } from '../track-write-coordinator.js';
import { Kid3Adapter } from './kid3.js';
import { loadPreferredLyricsSource } from './lyrics-source.js';

const MAX_OFFSET_MS = 300_000;

export class LyricsOffsetError extends Error {
  constructor(
    readonly kind: 'track_not_found' | 'lyrics_missing' | 'source_changed' | 'invalid_offset',
    message: string,
  ) {
    super(message);
    this.name = 'LyricsOffsetError';
  }
}

function formatTimestamp(seconds: number): string {
  const milliseconds = Math.max(0, Math.round(seconds * 1000));
  const minutes = Math.floor(milliseconds / 60_000);
  const remainder = milliseconds % 60_000;
  const wholeSeconds = Math.floor(remainder / 1000);
  const fraction = remainder % 1000;
  return `[${String(minutes).padStart(2, '0')}:${String(wholeSeconds).padStart(2, '0')}.${String(fraction).padStart(3, '0')}]`;
}

export function applyOffsetForEmbedding(raw: string, offsetMs: number): string {
  if (!Number.isSafeInteger(offsetMs) || Math.abs(offsetMs) > MAX_OFFSET_MS) {
    throw new LyricsOffsetError('invalid_offset', '歌词偏移必须是 ±300 秒以内的整数毫秒');
  }
  const parsed = parseLrc(raw);
  if (parsed.lines.length === 0) {
    throw new LyricsOffsetError('lyrics_missing', '当前歌词没有可以写入的同步时间戳');
  }
  return `${parsed.lines
    .map((line) => `${formatTimestamp(line.time + offsetMs / 1000)}${line.text}`)
    .join('\n')}\n`;
}

export class LyricsOffsetService {
  constructor(
    private readonly database: LibraryDatabase,
    private readonly library: LibraryService,
    private readonly kid3: Kid3Adapter,
    private readonly trackWrites: TrackWriteCoordinator,
  ) {}

  async writeAdjustedTiming(
    trackId: string,
    offsetMs: number,
    expectedRevision: string,
  ): Promise<LyricsTimingWriteResult> {
    const track = this.database.getTrackLocation(trackId);
    if (!track) throw new LyricsOffsetError('track_not_found', '音乐库中找不到这首歌曲');

    const source = await loadPreferredLyricsSource(track);
    if (!source) throw new LyricsOffsetError('lyrics_missing', '找不到可写入音频的同步歌词');
    if (source.revision !== expectedRevision) {
      throw new LyricsOffsetError('source_changed', '歌词来源已经改变，请重新载入后再保存偏移');
    }

    const adjusted = applyOffsetForEmbedding(source.raw, offsetMs);
    const lineCount = parseLrc(adjusted).lines.length;
    await this.trackWrites.run(
      trackId,
      () => this.kid3.writeLyricsAndVerify(
        track.filePath,
        adjusted,
        'Lyralume / Time Adjusted',
      ),
    );

    this.database.setTrackEmbeddedLyrics(trackId, true);
    this.database.setTrackPreferEmbeddedLyrics(trackId, true);
    this.library.refreshSnapshot();
    return { appliedOffsetMs: offsetMs, lineCount, source: source.source };
  }
}
