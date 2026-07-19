export interface LyricLine {
  id: string;
  time: number;
  text: string;
}

export type LyricCueLineRole = 'original' | 'translation' | 'additional';

export interface LyricCueLine extends LyricLine {
  role: LyricCueLineRole;
}

export interface LyricCue {
  id: string;
  time: number;
  lines: LyricCueLine[];
}

export interface ParsedLyrics {
  lines: LyricLine[];
  metadata: Record<string, string>;
  sourceOffsetMs: number;
}

const TIMESTAMP = /\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g;
const METADATA = /^\[([a-zA-Z]+):([^\]]*)\]$/;

function fractionToSeconds(raw = '0'): number {
  if (raw.length === 1) return Number(raw) / 10;
  if (raw.length === 2) return Number(raw) / 100;
  return Number(raw.slice(0, 3)) / 1000;
}

export function parseLrc(raw: string): ParsedLyrics {
  const metadata: Record<string, string> = {};
  const parsed: Array<Omit<LyricLine, 'id'>> = [];

  for (const originalLine of raw.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const line = originalLine.trim();
    if (!line) continue;

    TIMESTAMP.lastIndex = 0;
    const stamps = [...line.matchAll(TIMESTAMP)];
    if (stamps.length === 0) {
      const match = line.match(METADATA);
      if (match) metadata[match[1].toLowerCase()] = match[2].trim();
      continue;
    }

    const text = line.replace(TIMESTAMP, '').trim();
    for (const stamp of stamps) {
      const minutes = Number(stamp[1]);
      const seconds = Number(stamp[2]);
      const fraction = fractionToSeconds(stamp[3]);
      if (!Number.isFinite(minutes) || seconds >= 60) continue;
      parsed.push({ time: minutes * 60 + seconds + fraction, text });
    }
  }

  parsed.sort((a, b) => a.time - b.time);
  const lines = parsed.map((line, index) => ({
    ...line,
    id: `${line.time.toFixed(3)}-${index}`,
  }));

  const sourceOffsetMs = Number.parseInt(metadata.offset ?? '0', 10);
  return {
    lines,
    metadata,
    sourceOffsetMs: Number.isFinite(sourceOffsetMs) ? sourceOffsetMs : 0,
  };
}

const HAN_SCRIPT = /\p{Script=Han}/u;
const JAPANESE_KANA = /[\p{Script=Hiragana}\p{Script=Katakana}]/u;
const KOREAN_HANGUL = /\p{Script=Hangul}/u;

function isLikelyChineseTranslation(text: string): boolean {
  return HAN_SCRIPT.test(text)
    && !JAPANESE_KANA.test(text)
    && !KOREAN_HANGUL.test(text);
}

function orderCueLines(lines: LyricLine[]): LyricCueLine[] {
  if (lines.length === 1) return [{ ...lines[0], role: 'original' }];

  const chineseLines = lines.filter((line) => isLikelyChineseTranslation(line.text));
  const otherLines = lines.filter((line) => !isLikelyChineseTranslation(line.text));
  const canIdentifyTranslation = chineseLines.length === 1 && otherLines.length > 0;
  const ordered = canIdentifyTranslation
    ? [otherLines[0], chineseLines[0], ...otherLines.slice(1)]
    : lines;

  return ordered.map((line, index) => ({
    ...line,
    role: index === 0 ? 'original' : index === 1 ? 'translation' : 'additional',
  }));
}

/**
 * Turns flat LRC rows into playback cues. Rows that share an exact millisecond
 * timestamp are one cue, so bilingual rows receive one active state.
 */
export function groupLyricLines(lines: LyricLine[]): LyricCue[] {
  const groups = new Map<number, LyricLine[]>();
  for (const line of lines) {
    const timestampMs = Math.round(line.time * 1_000);
    const group = groups.get(timestampMs);
    if (group) group.push(line);
    else groups.set(timestampMs, [line]);
  }

  return [...groups.entries()]
    .sort(([left], [right]) => left - right)
    .map(([timestampMs, groupedLines]) => ({
      id: `cue-${timestampMs}-${groupedLines.map((line) => line.id).join('-')}`,
      time: timestampMs / 1_000,
      lines: orderCueLines(groupedLines),
    }));
}

export function findActiveLyricIndex(
  lines: ReadonlyArray<{ time: number }>,
  currentTime: number,
  offsetMs = 0,
): number {
  const adjustedTime = currentTime - offsetMs / 1000;
  let low = 0;
  let high = lines.length - 1;
  let result = -1;

  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    if (lines[middle].time <= adjustedTime) {
      result = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return result;
}
