export interface LyricLine {
  id: string;
  time: number;
  text: string;
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

export function findActiveLyricIndex(
  lines: LyricLine[],
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
