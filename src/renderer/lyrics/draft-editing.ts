import type { LocalLyricsDraftLine } from '../../shared/contracts';

function uniqueId(lines: LocalLyricsDraftLine[], base: string): string {
  const ids = new Set(lines.map((line) => line.id));
  let suffix = 1;
  while (ids.has(`${base}-s${suffix}`)) suffix += 1;
  return `${base}-s${suffix}`;
}

function splitPoint(text: string): number {
  const middle = Math.floor(text.length / 2);
  const whitespace = [...text.matchAll(/\s+/g)]
    .map((match) => match.index ?? middle)
    .sort((a, b) => Math.abs(a - middle) - Math.abs(b - middle))[0];
  return whitespace && whitespace > 0 && whitespace < text.length ? whitespace : middle;
}

export function splitDraftLine(
  lines: LocalLyricsDraftLine[],
  lineId: string,
): LocalLyricsDraftLine[] {
  const index = lines.findIndex((line) => line.id === lineId);
  const line = lines[index];
  if (!line || line.text.trim().length < 2) return lines;
  const point = splitPoint(line.text);
  const firstText = line.text.slice(0, point).trim();
  const secondText = line.text.slice(point).trim();
  if (!firstText || !secondText) return lines;
  const middleTime = line.startTime + (line.endTime - line.startTime) * (point / line.text.length);
  return [
    ...lines.slice(0, index),
    { ...line, text: firstText, endTime: middleTime, tokens: undefined },
    {
      ...line,
      id: uniqueId(lines, line.id),
      text: secondText,
      startTime: middleTime,
      tokens: undefined,
    },
    ...lines.slice(index + 1),
  ];
}

export function mergeDraftLineWithPrevious(
  lines: LocalLyricsDraftLine[],
  lineId: string,
): LocalLyricsDraftLine[] {
  const index = lines.findIndex((line) => line.id === lineId);
  if (index <= 0) return lines;
  const previous = lines[index - 1];
  const current = lines[index];
  const noSpace = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]$/u.test(previous.text)
    || /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}，。！？、]/u.test(current.text);
  const scores = [previous.confidence, current.confidence]
    .filter((score): score is number => score !== null);
  const merged: LocalLyricsDraftLine = {
    ...previous,
    endTime: Math.max(previous.endTime, current.endTime),
    text: `${previous.text}${noSpace ? '' : ' '}${current.text}`,
    confidence: scores.length > 0
      ? scores.reduce((sum, score) => sum + score, 0) / scores.length
      : null,
    flags: [...new Set([...previous.flags, ...current.flags])],
    tokens: undefined,
  };
  return [...lines.slice(0, index - 1), merged, ...lines.slice(index + 1)];
}

export function updateDraftLineTime(
  line: LocalLyricsDraftLine,
  startTime: number,
): LocalLyricsDraftLine {
  const nextStart = Math.max(0, Number.isFinite(startTime) ? startTime : line.startTime);
  const duration = Math.max(0, line.endTime - line.startTime);
  return {
    ...line,
    startTime: nextStart,
    endTime: nextStart + duration,
    ...(line.tokens
      ? {
          tokens: line.tokens.map((token) => ({
            ...token,
            startTime: token.startTime + nextStart - line.startTime,
            endTime: token.endTime + nextStart - line.startTime,
          })),
        }
      : {}),
    flags: line.flags.filter((flag) => flag !== 'missing_timing'),
  };
}
