export interface LyricLine {
  id: string;
  time: number;
  text: string;
  endTime?: number;
  tokens?: TimedLyricToken[];
}

export interface TimedLyricToken {
  text: string;
  startTime: number;
  endTime: number;
  confidence?: number;
}

export interface PreciseLyricLineTiming {
  time: number;
  endTime: number;
  text: string;
  tokens: TimedLyricToken[];
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
const ENHANCED_TIMESTAMP = /<(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?>/g;
const METADATA = /^\[([a-zA-Z]+):([^\]]*)\]$/;

function fractionToSeconds(raw = '0'): number {
  if (raw.length === 1) return Number(raw) / 10;
  if (raw.length === 2) return Number(raw) / 100;
  return Number(raw.slice(0, 3)) / 1000;
}

function timestampToSeconds(match: RegExpMatchArray): number | undefined {
  const minutes = Number(match[1]);
  const seconds = Number(match[2]);
  const fraction = fractionToSeconds(match[3]);
  if (!Number.isFinite(minutes) || seconds >= 60) return undefined;
  return minutes * 60 + seconds + fraction;
}

function normalizedLyricText(text: string): string {
  return text.normalize('NFKC').replace(/\s+/g, ' ').trim();
}

export function timedTokensMatchText(
  tokens: ReadonlyArray<Pick<TimedLyricToken, 'text'>>,
  text: string,
): boolean {
  return tokens.length > 0
    && normalizedLyricText(tokens.map((token) => token.text).join('')) === normalizedLyricText(text);
}

interface ParsedEnhancedToken {
  text: string;
  startTime: number;
}

function parseEnhancedTokens(rawText: string): ParsedEnhancedToken[] {
  ENHANCED_TIMESTAMP.lastIndex = 0;
  const stamps = [...rawText.matchAll(ENHANCED_TIMESTAMP)];
  if (stamps.length === 0) return [];
  const prefix = rawText.slice(0, stamps[0].index).trim();
  if (prefix) return [];

  const tokens = stamps.flatMap((stamp, index): ParsedEnhancedToken[] => {
    const startTime = timestampToSeconds(stamp);
    const textStart = (stamp.index ?? 0) + stamp[0].length;
    const textEnd = stamps[index + 1]?.index ?? rawText.length;
    const text = rawText.slice(textStart, textEnd);
    return startTime === undefined || !text.trim() ? [] : [{ text, startTime }];
  });
  const visibleText = rawText.replace(ENHANCED_TIMESTAMP, '').trim();
  return timedTokensMatchText(tokens, visibleText) ? tokens : [];
}

export function parseLrc(raw: string): ParsedLyrics {
  const metadata: Record<string, string> = {};
  const parsed: Array<Omit<LyricLine, 'id' | 'tokens'> & { enhancedTokens?: ParsedEnhancedToken[] }> = [];

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

    const stampedText = line.replace(TIMESTAMP, '').trim();
    const text = stampedText.replace(ENHANCED_TIMESTAMP, '').trim();
    const enhancedTokens = stamps.length === 1 ? parseEnhancedTokens(stampedText) : [];
    for (const stamp of stamps) {
      const time = timestampToSeconds(stamp);
      if (time === undefined) continue;
      parsed.push({ time, text, enhancedTokens });
    }
  }

  parsed.sort((a, b) => a.time - b.time);
  const lines = parsed.map((line, index): LyricLine => {
    const { enhancedTokens, ...plainLine } = line;
    if (!enhancedTokens?.length) {
      return { ...plainLine, id: `${line.time.toFixed(3)}-${index}` };
    }
    const nextLineTime = parsed.find((candidate) => candidate.time > line.time)?.time;
    const tokens = enhancedTokens.map((token, tokenIndex): TimedLyricToken => ({
      ...token,
      endTime: Math.max(
        token.startTime,
        enhancedTokens[tokenIndex + 1]?.startTime
          ?? nextLineTime
          ?? token.startTime + Math.max(0.18, token.text.trim().length * 0.12),
      ),
    }));
    return {
      ...plainLine,
      id: `${line.time.toFixed(3)}-${index}`,
      endTime: tokens.at(-1)?.endTime,
      tokens,
    };
  });

  const sourceOffsetMs = Number.parseInt(metadata.offset ?? '0', 10);
  return {
    lines,
    metadata,
    sourceOffsetMs: Number.isFinite(sourceOffsetMs) ? sourceOffsetMs : 0,
  };
}

/**
 * Adds optional word/character timing only when it still describes the loaded
 * lyric row exactly. Edited or shifted LRC files therefore fall back safely to
 * line-level progress instead of showing stale token timing.
 */
export function mergePreciseLyricTiming(
  lines: LyricLine[],
  preciseTiming: readonly PreciseLyricLineTiming[] | undefined,
): LyricLine[] {
  if (!preciseTiming?.length) return lines;
  const unused = new Set(preciseTiming.map((_, index) => index));
  return lines.map((line) => {
    const timingIndex = preciseTiming.findIndex((candidate, index) => (
      unused.has(index)
      && Math.abs(candidate.time - line.time) <= 0.035
      && normalizedLyricText(candidate.text) === normalizedLyricText(line.text)
      && timedTokensMatchText(candidate.tokens, line.text)
    ));
    if (timingIndex < 0) return line;
    const timing = preciseTiming[timingIndex];
    unused.delete(timingIndex);
    return {
      ...line,
      endTime: timing.endTime,
      tokens: timing.tokens.map((token) => ({ ...token })),
    };
  });
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
