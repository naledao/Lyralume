import type { LocalLyricsTask } from '../../shared/contracts.js';
import {
  timedTokensMatchText,
  type PreciseLyricLineTiming,
  type TimedLyricToken,
} from '../../shared/lrc.js';
import type { LyricsSourceKind } from './lyrics-source.js';

function validTokens(value: unknown, text: string): TimedLyricToken[] | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined;
  const tokens: TimedLyricToken[] = [];
  for (const candidate of value) {
    if (!candidate || typeof candidate !== 'object') return undefined;
    const token = candidate as Partial<TimedLyricToken>;
    if (
      typeof token.text !== 'string'
      || !token.text.trim()
      || !Number.isFinite(token.startTime)
      || !Number.isFinite(token.endTime)
      || (token.startTime as number) < 0
      || (token.endTime as number) < (token.startTime as number)
    ) return undefined;
    tokens.push({
      text: token.text,
      startTime: token.startTime as number,
      endTime: token.endTime as number,
      ...(typeof token.confidence === 'number' && Number.isFinite(token.confidence)
        ? { confidence: Math.min(1, Math.max(0, token.confidence)) }
        : {}),
    });
  }
  return timedTokensMatchText(tokens, text) ? tokens : undefined;
}

export function preciseTimingForLocalTask(
  task: LocalLyricsTask | undefined,
  source: LyricsSourceKind,
): PreciseLyricLineTiming[] | undefined {
  if (!task) return undefined;
  const timingBelongsToSource = source === 'lrc'
    ? task.lrcSaveStatus === 'saved'
    : task.tagWriteStatus === 'verified';
  if (!timingBelongsToSource) return undefined;

  const offsetSeconds = Number.isFinite(task.draftOffsetMs) ? task.draftOffsetMs / 1_000 : 0;
  const preciseTiming = task.draftLines.flatMap((line): PreciseLyricLineTiming[] => {
    const tokens = validTokens(line.tokens, line.text);
    if (
      !tokens
      || !Number.isFinite(line.startTime)
      || !Number.isFinite(line.endTime)
      || line.startTime < 0
      || line.endTime < line.startTime
    ) return [];
    return [{
      time: Math.max(0, line.startTime + offsetSeconds),
      endTime: Math.max(0, line.endTime + offsetSeconds),
      text: line.text,
      tokens: tokens.map((token) => ({
        ...token,
        startTime: Math.max(0, token.startTime + offsetSeconds),
        endTime: Math.max(0, token.endTime + offsetSeconds),
      })),
    }];
  });
  return preciseTiming.length > 0 ? preciseTiming : undefined;
}
