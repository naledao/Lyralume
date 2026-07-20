import type {
  TrackVisualDNA,
  TrackVisualSection,
  TrackVisualTimeline,
  VisualAxes,
} from '../../shared/visual-analysis';

export type VisualCueKind =
  | 'downbeat'
  | 'push'
  | 'accent'
  | 'rebound'
  | 'drop'
  | 'section-enter';

export interface VisualCue {
  id: string;
  kind: VisualCueKind;
  timeMs: number;
  intensity: number;
  direction: -1 | 1;
  attackMs: number;
  holdMs: number;
  releaseMs: number;
}

export interface VisualDirectorFrame {
  zoom: number;
  rotation: number;
  offsetX: number;
  offsetY: number;
  glow: number;
  burst: number;
}

export const NEUTRAL_VISUAL_DIRECTOR_FRAME: Readonly<VisualDirectorFrame> = Object.freeze({
  zoom: 0,
  rotation: 0,
  offsetX: 0,
  offsetY: 0,
  glow: 0,
  burst: 0,
});

const CUE_TIMING: Record<VisualCueKind, Pick<VisualCue, 'attackMs' | 'holdMs' | 'releaseMs'>> = {
  downbeat: { attackMs: 24, holdMs: 22, releaseMs: 230 },
  push: { attackMs: 30, holdMs: 10, releaseMs: 175 },
  accent: { attackMs: 16, holdMs: 8, releaseMs: 135 },
  rebound: { attackMs: 34, holdMs: 12, releaseMs: 210 },
  drop: { attackMs: 78, holdMs: 42, releaseMs: 620 },
  'section-enter': { attackMs: 260, holdMs: 80, releaseMs: 820 },
};

const MAX_CUE_DURATION_MS = Math.max(
  ...Object.values(CUE_TIMING).map((timing) => (
    timing.attackMs + timing.holdMs + timing.releaseMs
  )),
);

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, Number.isFinite(value) ? value : minimum));
}

function clampUnit(value: number): number {
  return clamp(value, 0, 1);
}

function directionFromSeed(seed: number, index: number): -1 | 1 {
  let mixed = (seed ^ Math.imul(index + 1, 0x9e3779b1)) >>> 0;
  mixed = Math.imul(mixed ^ (mixed >>> 16), 0x21f0aaad) >>> 0;
  mixed = Math.imul(mixed ^ (mixed >>> 15), 0x735a2d97) >>> 0;
  return ((mixed ^ (mixed >>> 15)) & 1) === 0 ? -1 : 1;
}

function axisDistance(left: VisualAxes, right: VisualAxes): number {
  return (
    Math.abs(left.drive - right.drive) * 0.25
    + Math.abs(left.pulse - right.pulse) * 0.2
    + Math.abs(left.brightness - right.brightness) * 0.08
    + Math.abs(left.texture - right.texture) * 0.08
    + Math.abs(left.tonality - right.tonality) * 0.06
    + Math.abs(left.dynamics - right.dynamics) * 0.14
    + Math.abs(left.space - right.space) * 0.1
    + Math.abs(left.complexity - right.complexity) * 0.09
  );
}

function sectionAt(
  sections: readonly TrackVisualSection[],
  timeMs: number,
): TrackVisualSection | undefined {
  let low = 0;
  let high = sections.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if ((sections[middle]?.startMs ?? Number.POSITIVE_INFINITY) <= timeMs) low = middle + 1;
    else high = middle;
  }
  return low === 0 ? undefined : sections[low - 1];
}

function beatKind(index: number): VisualCueKind {
  switch (index % 4) {
    case 0: return 'downbeat';
    case 1: return 'push';
    case 2: return 'accent';
    default: return 'rebound';
  }
}

function beatIntensity(
  kind: VisualCueKind,
  dna: TrackVisualDNA,
  section: TrackVisualSection | undefined,
): number {
  const axes = section?.axes ?? dna.axes;
  const base = 0.22
    + axes.drive * 0.28
    + axes.pulse * 0.26
    + axes.dynamics * 0.12
    + dna.burstPower * 0.12;
  const kindScale = kind === 'downbeat'
    ? 1.08
    : kind === 'accent'
      ? 0.82 + axes.brightness * 0.12
      : kind === 'rebound'
        ? 0.72
        : 0.78;
  return clamp(base * kindScale, 0.18, 1);
}

function makeCue(
  kind: VisualCueKind,
  timeMs: number,
  intensity: number,
  direction: -1 | 1,
  index: number,
): VisualCue {
  return {
    id: `${kind}:${Math.round(timeMs)}:${index}`,
    kind,
    timeMs,
    intensity: clampUnit(intensity),
    direction,
    ...CUE_TIMING[kind],
  };
}

/**
 * Turns the cached beat/section analysis into a deterministic visual score.
 * This remains renderer-local so adding direction does not invalidate the
 * persisted audio analysis format or require decoding a track again.
 */
export function buildVisualCues(
  timeline: TrackVisualTimeline | undefined,
  dna: TrackVisualDNA,
): VisualCue[] {
  if (!timeline) return [];
  const sections = timeline.sections
    .filter((section) => Number.isFinite(section.startMs) && Number.isFinite(section.endMs))
    .slice()
    .sort((left, right) => left.startMs - right.startMs);
  const beats = [...new Set(
    timeline.beatsMs
      .filter((timeMs) => Number.isFinite(timeMs) && timeMs >= 0)
      .map((timeMs) => Math.round(timeMs)),
  )].sort((left, right) => left - right);
  const cues: VisualCue[] = [];

  for (let index = 0; index < beats.length; index += 1) {
    const timeMs = beats[index];
    const kind = beatKind(index);
    cues.push(makeCue(
      kind,
      timeMs,
      beatIntensity(kind, dna, sectionAt(sections, timeMs)),
      directionFromSeed(dna.seed, index),
      index,
    ));
  }

  for (let index = 0; index < sections.length; index += 1) {
    const section = sections[index];
    const previous = sections[index - 1];
    const energyLift = previous
      ? (section.axes.drive - previous.axes.drive) * 0.58
        + (section.axes.pulse - previous.axes.pulse) * 0.28
        + (section.axes.dynamics - previous.axes.dynamics) * 0.14
      : 0;
    const kind: VisualCueKind = previous && energyLift >= 0.12 ? 'drop' : 'section-enter';
    const contrast = previous ? axisDistance(section.axes, previous.axes) : 0.24;
    const intensity = clamp(
      0.24
        + contrast * 1.6
        + Math.max(0, energyLift) * 0.82
        + section.axes.space * 0.08,
      0.24,
      1,
    );
    cues.push(makeCue(
      kind,
      Math.max(0, section.startMs),
      intensity,
      directionFromSeed(dna.seed ^ 0xa53c9e1d, index),
      beats.length + index,
    ));
  }

  return cues.sort((left, right) => (
    left.timeMs - right.timeMs || left.id.localeCompare(right.id)
  ));
}

function easeOutCubic(progress: number): number {
  return 1 - (1 - clampUnit(progress)) ** 3;
}

function easeInOutSine(progress: number): number {
  return -(Math.cos(Math.PI * clampUnit(progress)) - 1) / 2;
}

function cueEnvelope(cue: VisualCue, timeMs: number): number {
  const localTime = timeMs - cue.timeMs;
  if (localTime < 0) return 0;
  if (localTime < cue.attackMs) return easeOutCubic(localTime / Math.max(1, cue.attackMs));
  if (localTime < cue.attackMs + cue.holdMs) return 1;
  const releaseTime = localTime - cue.attackMs - cue.holdMs;
  if (releaseTime >= cue.releaseMs) return 0;
  return 1 - easeInOutSine(releaseTime / Math.max(1, cue.releaseMs));
}

function lowerBound(cues: readonly VisualCue[], timeMs: number): number {
  let low = 0;
  let high = cues.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if ((cues[middle]?.timeMs ?? Number.POSITIVE_INFINITY) < timeMs) low = middle + 1;
    else high = middle;
  }
  return low;
}

export function sampleVisualDirector(
  cues: readonly VisualCue[],
  timeMs: number,
  reducedMotion = false,
): VisualDirectorFrame {
  if (cues.length === 0 || !Number.isFinite(timeMs)) {
    return { ...NEUTRAL_VISUAL_DIRECTOR_FRAME };
  }
  const frame: VisualDirectorFrame = { ...NEUTRAL_VISUAL_DIRECTOR_FRAME };
  const startIndex = lowerBound(cues, timeMs - MAX_CUE_DURATION_MS);

  for (let index = startIndex; index < cues.length; index += 1) {
    const cue = cues[index];
    if (cue.timeMs > timeMs) break;
    const amount = cueEnvelope(cue, timeMs) * cue.intensity;
    if (amount <= 0) continue;
    const direction = cue.direction;
    switch (cue.kind) {
      case 'downbeat':
        frame.zoom += amount * 0.038;
        frame.offsetY -= amount * 0.004;
        frame.glow = Math.max(frame.glow, amount * 0.82);
        frame.burst = Math.max(frame.burst, amount * 0.78);
        break;
      case 'push':
        frame.zoom += amount * 0.014;
        frame.offsetX += direction * amount * 0.016;
        frame.rotation += direction * amount * 0.006;
        frame.glow = Math.max(frame.glow, amount * 0.46);
        frame.burst = Math.max(frame.burst, amount * 0.38);
        break;
      case 'accent':
        frame.zoom += amount * 0.008;
        frame.offsetY -= amount * 0.009;
        frame.rotation += direction * amount * 0.016;
        frame.glow = Math.max(frame.glow, amount * 0.68);
        frame.burst = Math.max(frame.burst, amount * 0.54);
        break;
      case 'rebound':
        frame.zoom -= amount * 0.012;
        frame.offsetX -= direction * amount * 0.008;
        frame.offsetY += amount * 0.006;
        frame.rotation -= direction * amount * 0.004;
        frame.glow = Math.max(frame.glow, amount * 0.3);
        frame.burst = Math.max(frame.burst, amount * 0.24);
        break;
      case 'drop':
        frame.zoom += amount * 0.064;
        frame.offsetY += amount * 0.012;
        frame.rotation += direction * amount * 0.008;
        frame.glow = Math.max(frame.glow, amount);
        frame.burst = Math.max(frame.burst, amount);
        break;
      case 'section-enter':
        frame.zoom += amount * 0.022;
        frame.offsetX += direction * amount * 0.01;
        frame.rotation += direction * amount * 0.004;
        frame.glow = Math.max(frame.glow, amount * 0.52);
        frame.burst = Math.max(frame.burst, amount * 0.18);
        break;
      default:
        break;
    }
  }

  frame.zoom = clamp(frame.zoom, -0.025, 0.095);
  frame.rotation = clamp(frame.rotation, -0.045, 0.045);
  frame.offsetX = clamp(frame.offsetX, -0.045, 0.045);
  frame.offsetY = clamp(frame.offsetY, -0.045, 0.045);
  frame.glow = clampUnit(frame.glow);
  frame.burst = clampUnit(frame.burst);

  if (reducedMotion) {
    frame.zoom *= 0.14;
    frame.rotation = 0;
    frame.offsetX *= 0.08;
    frame.offsetY *= 0.08;
    frame.glow *= 0.55;
    frame.burst *= 0.2;
  }
  return frame;
}
