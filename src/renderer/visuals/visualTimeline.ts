import type { TrackVisualSection } from '../../shared/visual-analysis';

export function currentVisualSection(
  sections: readonly TrackVisualSection[],
  timeMs: number,
): TrackVisualSection | undefined {
  return sections.find((section) => timeMs >= section.startMs && timeMs < section.endMs)
    ?? sections.at(-1);
}

export function crossedBeat(
  beatsMs: readonly number[],
  previousTimeMs: number,
  currentTimeMs: number,
  timingOffsetMs = 0,
): boolean {
  if (currentTimeMs < previousTimeMs || currentTimeMs - previousTimeMs > 500) return false;
  const lower = previousTimeMs + timingOffsetMs;
  const upper = currentTimeMs + timingOffsetMs;
  let left = 0;
  let right = beatsMs.length;
  while (left < right) {
    const middle = (left + right) >>> 1;
    if ((beatsMs[middle] ?? 0) <= lower) left = middle + 1;
    else right = middle;
  }
  return left < beatsMs.length && (beatsMs[left] ?? Number.POSITIVE_INFINITY) <= upper;
}
