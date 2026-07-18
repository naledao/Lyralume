import type { OnlineLyricsCandidate } from '../../shared/contracts.js';
import { parseLrc } from '../../shared/lrc.js';
import type { LrclibRecord, LyricsSearchTrack } from './lrclib.js';

function normalize(value: string): string {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/[\p{P}\p{S}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function bigrams(value: string): string[] {
  const compact = normalize(value).replace(/\s/g, '');
  if (compact.length < 2) return compact ? [compact] : [];
  return Array.from({ length: compact.length - 1 }, (_, index) => compact.slice(index, index + 2));
}

export function textSimilarity(left: string, right: string): number {
  const normalizedLeft = normalize(left);
  const normalizedRight = normalize(right);
  if (!normalizedLeft || !normalizedRight) return 0;
  if (normalizedLeft === normalizedRight) return 1;

  const leftPairs = bigrams(normalizedLeft);
  const rightPairs = bigrams(normalizedRight);
  const remaining = new Map<string, number>();
  for (const pair of rightPairs) remaining.set(pair, (remaining.get(pair) ?? 0) + 1);
  let intersection = 0;
  for (const pair of leftPairs) {
    const count = remaining.get(pair) ?? 0;
    if (count > 0) {
      intersection += 1;
      remaining.set(pair, count - 1);
    }
  }
  return (2 * intersection) / (leftPairs.length + rightPairs.length);
}

function lyricsPreview(raw: string): string {
  const text = parseLrc(raw).lines
    .map((line) => line.text)
    .filter(Boolean)
    .slice(0, 3)
    .join(' / ');
  return text.length > 140 ? `${text.slice(0, 137)}…` : text;
}

function scoreRecord(track: LyricsSearchTrack, record: LrclibRecord): Omit<OnlineLyricsCandidate, 'recommended'> {
  const durationDelta = track.duration > 0 && record.duration > 0
    ? Math.abs(track.duration - record.duration)
    : 0;
  const durationScore = track.duration > 0 && record.duration > 0
    ? Math.max(0, 1 - durationDelta / 18)
    : 0.45;
  const albumScore = normalize(track.album) === '未知专辑'
    ? 0.5
    : textSimilarity(track.album, record.albumName);
  const artistScore = normalize(track.artist) === '未知艺术家'
    ? 0.35
    : textSimilarity(track.artist, record.artistName);
  const weighted =
    textSimilarity(track.title, record.trackName) * 0.4
    + artistScore * 0.27
    + albumScore * 0.1
    + durationScore * 0.23;
  const score = Math.round(weighted * 100);

  return {
    id: record.id,
    trackName: record.trackName,
    artistName: record.artistName,
    albumName: record.albumName,
    duration: record.duration,
    instrumental: record.instrumental,
    syncedLyrics: record.syncedLyrics ?? '',
    preview: lyricsPreview(record.syncedLyrics ?? ''),
    score,
    durationDelta: Math.round(durationDelta * 10) / 10,
    confidence: score >= 86 && durationDelta <= 3 ? 'high' : score >= 68 ? 'medium' : 'low',
  };
}

export function rankLyricsCandidates(
  track: LyricsSearchTrack,
  records: LrclibRecord[],
): OnlineLyricsCandidate[] {
  const ranked = records
    .filter((record) => Boolean(record.syncedLyrics?.trim()) && !record.instrumental)
    .map((record) => scoreRecord(track, record))
    .sort((left, right) => right.score - left.score || left.durationDelta - right.durationDelta)
    .slice(0, 10);
  const gap = ranked.length > 1 ? ranked[0].score - ranked[1].score : ranked[0]?.score ?? 0;
  return ranked.map((candidate, index) => ({
    ...candidate,
    recommended: index === 0 && candidate.confidence === 'high' && (ranked.length === 1 || gap >= 6),
  }));
}
