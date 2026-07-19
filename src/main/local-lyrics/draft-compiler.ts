import type { LocalLyricsDraftLine, LocalLyricsDraftUpdate, LocalLyricsLineFlag } from '../../shared/contracts.js';

interface AlignmentToken {
  text: string;
  start?: number;
  end?: number;
  score?: number;
}

interface AlignmentSegment {
  text: string;
  start?: number;
  end?: number;
  tokens: AlignmentToken[];
}

const LOW_CONFIDENCE_THRESHOLD = 0.65;
const MAX_LINE_CHARACTERS = 34;
const MAX_LINE_DURATION = 8;
const PAUSE_SPLIT_SECONDS = 1.2;

export class DraftValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DraftValidationError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function parseToken(value: unknown): AlignmentToken | undefined {
  if (!isRecord(value)) return undefined;
  const textValue = typeof value.word === 'string'
    ? value.word
    : typeof value.char === 'string' ? value.char : undefined;
  if (!textValue?.trim()) return undefined;
  const score = typeof value.score === 'number' && Number.isFinite(value.score)
    ? Math.min(1, Math.max(0, value.score))
    : undefined;
  return {
    text: textValue,
    start: finiteNumber(value.start),
    end: finiteNumber(value.end),
    score,
  };
}

function parseSegments(value: unknown): AlignmentSegment[] {
  if (!isRecord(value) || !Array.isArray(value.segments)) {
    throw new DraftValidationError('对齐结果缺少 segments 数组');
  }
  return value.segments.flatMap((candidate): AlignmentSegment[] => {
    if (!isRecord(candidate)) return [];
    const text = typeof candidate.text === 'string' ? candidate.text.trim() : '';
    const wordValues = Array.isArray(candidate.words) ? candidate.words : [];
    const charValues = Array.isArray(candidate.chars) ? candidate.chars : [];
    const words = wordValues.flatMap((word) => {
      const parsed = parseToken(word);
      return parsed ? [parsed] : [];
    });
    const chars = charValues.flatMap((character) => {
      const parsed = parseToken(character);
      return parsed ? [parsed] : [];
    });
    const tokens = words.length > 0
      ? words
      : chars.length > 0 ? chars : text ? [{ text }] : [];
    if (tokens.length === 0) return [];
    return [{
      text,
      start: finiteNumber(candidate.start),
      end: finiteNumber(candidate.end),
      tokens,
    }];
  });
}

function appendText(current: string, next: string): string {
  const token = next.replace(/\s+/g, ' ').trim();
  if (!current || !token) return `${current}${token}`;
  const previous = current.at(-1) ?? '';
  const first = token[0];
  const joinsWithoutSpace = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(previous)
    || /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}，。！？、；：,.!?;:'”’)]/u.test(first)
    || /[(“‘]$/u.test(previous);
  return `${current}${joinsWithoutSpace ? '' : ' '}${token}`;
}

function endsPhrase(text: string): boolean {
  return /[。！？!?；;]$/.test(text.trim());
}

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function compileAlignmentToDraft(raw: unknown): LocalLyricsDraftLine[] {
  const segments = parseSegments(raw);
  const lines: LocalLyricsDraftLine[] = [];
  let previousEnd = 0;

  for (const segment of segments) {
    let text = '';
    let start: number | undefined;
    let end: number | undefined;
    let missingTiming = false;
    const scores: number[] = [];

    const flush = (): void => {
      const cleaned = text.trim();
      if (!cleaned) return;
      const startTime = start ?? segment.start ?? previousEnd;
      const endTime = Math.max(startTime, end ?? segment.end ?? startTime);
      const confidence = average(scores);
      const flags: LocalLyricsLineFlag[] = [];
      if (missingTiming || start === undefined || end === undefined) flags.push('missing_timing');
      if (confidence === null || confidence < LOW_CONFIDENCE_THRESHOLD) flags.push('low_confidence');
      lines.push({
        id: `draft-${lines.length + 1}`,
        startTime,
        endTime,
        text: cleaned,
        confidence,
        flags,
      });
      previousEnd = endTime;
      text = '';
      start = undefined;
      end = undefined;
      missingTiming = false;
      scores.length = 0;
    };

    for (const token of segment.tokens) {
      const pause = start !== undefined && end !== undefined && token.start !== undefined
        ? token.start - end
        : 0;
      const prospective = appendText(text, token.text);
      const prospectiveDuration = start !== undefined && token.end !== undefined
        ? token.end - start
        : 0;
      if (text && (
        pause > PAUSE_SPLIT_SECONDS
        || prospective.length > MAX_LINE_CHARACTERS
        || prospectiveDuration > MAX_LINE_DURATION
      )) flush();

      text = appendText(text, token.text);
      start ??= token.start;
      end = token.end ?? end;
      if (token.start === undefined || token.end === undefined) missingTiming = true;
      if (token.score !== undefined) scores.push(token.score);
      if (endsPhrase(text)) flush();
    }
    flush();
  }

  if (lines.length === 0) throw new DraftValidationError('对齐结果中没有可编译的歌词内容');
  return lines;
}

function cleanFlags(flags: unknown): LocalLyricsLineFlag[] {
  if (!Array.isArray(flags)) return [];
  return [...new Set(flags.filter((flag): flag is LocalLyricsLineFlag => (
    flag === 'low_confidence' || flag === 'missing_timing'
  )))];
}

export function validateDraftUpdate(update: LocalLyricsDraftUpdate): LocalLyricsDraftUpdate {
  if (!update || !Array.isArray(update.lines) || update.lines.length === 0 || update.lines.length > 10_000) {
    throw new DraftValidationError('歌词草稿必须包含 1 到 10000 行');
  }
  if (!Number.isFinite(update.offsetMs) || Math.abs(update.offsetMs) > 300_000) {
    throw new DraftValidationError('歌词整体偏移必须在正负 5 分钟内');
  }
  const ids = new Set<string>();
  const lines = update.lines.map((line, index): LocalLyricsDraftLine => {
    if (!line || typeof line !== 'object') throw new DraftValidationError(`第 ${index + 1} 行无效`);
    const text = typeof line.text === 'string'
      ? line.text.replace(/[\r\n\0]+/g, ' ').trim()
      : '';
    if (!text || text.length > 1_000) {
      throw new DraftValidationError(`第 ${index + 1} 行歌词为空或超过 1000 个字符`);
    }
    if (!Number.isFinite(line.startTime) || line.startTime < 0 || line.startTime > 24 * 60 * 60) {
      throw new DraftValidationError(`第 ${index + 1} 行开始时间无效`);
    }
    if (!Number.isFinite(line.endTime) || line.endTime < line.startTime || line.endTime > 24 * 60 * 60) {
      throw new DraftValidationError(`第 ${index + 1} 行结束时间无效`);
    }
    const id = typeof line.id === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(line.id)
      ? line.id
      : `draft-${index + 1}`;
    if (ids.has(id)) throw new DraftValidationError('歌词草稿包含重复行标识');
    ids.add(id);
    const confidence = line.confidence === null
      ? null
      : typeof line.confidence === 'number' && Number.isFinite(line.confidence)
        ? Math.min(1, Math.max(0, line.confidence))
        : null;
    return {
      id,
      startTime: line.startTime,
      endTime: line.endTime,
      text,
      confidence,
      flags: cleanFlags(line.flags),
    };
  });
  for (let index = 1; index < lines.length; index += 1) {
    if (lines[index].startTime < lines[index - 1].startTime) {
      throw new DraftValidationError(`第 ${index + 1} 行开始时间早于上一行`);
    }
  }
  return { lines, offsetMs: Math.round(update.offsetMs) };
}

function formatTimestamp(seconds: number): string {
  const centiseconds = Math.max(0, Math.round(seconds * 100));
  const minutes = Math.floor(centiseconds / 6000);
  const remainder = centiseconds % 6000;
  return `[${String(minutes).padStart(2, '0')}:${String(Math.floor(remainder / 100)).padStart(2, '0')}.${String(remainder % 100).padStart(2, '0')}]`;
}

export function draftToLrc(update: LocalLyricsDraftUpdate, includeDraftNotice = false): string {
  const validated = validateDraftUpdate(update);
  const notice = includeDraftNotice ? ['[by:Lyralume AI 草稿（未经确认）]'] : [];
  const lines = validated.lines
    .map((line) => `${formatTimestamp(line.startTime + validated.offsetMs / 1000)}${line.text}`);
  return `${[...notice, ...lines].join('\n')}\n`;
}
