export const AUDIO_ANALYSIS_VERSION = 2;
export const VISUAL_MAPPING_VERSION = 2;

export const VISUAL_BAND_COUNT = 32;

export type VisualShapeFamily =
  | 'orbital'
  | 'bloom'
  | 'spiral'
  | 'lissajous'
  | 'flow'
  | 'burst'
  | 'constellation'
  | 'ribbon';

export type VisualAnalysisStatus = 'pending' | 'running' | 'ready' | 'stale' | 'failed';

export interface AudioFeatureFrame {
  timeMs: number;
  rms: number;
  peak: number;
  energy: number;
  bands: number[];
  chroma: number[];
  bass: number;
  lowMid: number;
  mid: number;
  highMid: number;
  treble: number;
  spectralCentroid: number;
  spectralSpread: number;
  spectralRolloff: number;
  spectralFlatness: number;
  spectralEntropy: number;
  spectralFlux: number;
  zeroCrossingRate: number;
  onset: boolean;
  onsetStrength: number;
}

export interface AudioDistribution {
  mean: number;
  p10: number;
  p50: number;
  p90: number;
  deviation: number;
}

export interface VisualAxes {
  drive: number;
  pulse: number;
  brightness: number;
  texture: number;
  tonality: number;
  dynamics: number;
  space: number;
  complexity: number;
}

export interface TrackAudioProfile {
  analysisVersion: number;
  durationMs: number;
  sampleRate: number;
  frameCount: number;
  rms: AudioDistribution;
  peak: AudioDistribution;
  centroid: AudioDistribution;
  spread: AudioDistribution;
  rolloff: AudioDistribution;
  flatness: AudioDistribution;
  entropy: AudioDistribution;
  flux: AudioDistribution;
  bandMeans: number[];
  bassRatio: number;
  lowMidRatio: number;
  midRatio: number;
  highMidRatio: number;
  trebleRatio: number;
  onsetRate: number;
  bpm: number | null;
  beatConfidence: number;
  tempoStability: number;
  chromaMeans: number[];
  key: string | null;
  mode: 'major' | 'minor' | null;
  keyConfidence: number;
  axes: VisualAxes;
}

export interface TrackVisualSection {
  id: string;
  startMs: number;
  endMs: number;
  axes: VisualAxes;
}

export interface TrackVisualTimeline {
  beatsMs: number[];
  sections: TrackVisualSection[];
}

export interface TrackVisualDNA {
  mappingVersion: number;
  seed: number;
  primaryShape: VisualShapeFamily;
  secondaryShape: VisualShapeFamily;
  shapeMix: number;
  symmetry: number;
  rotationDirection: -1 | 1;
  particleDensity: number;
  particleSize: number;
  trail: number;
  turbulence: number;
  attraction: number;
  burstPower: number;
  paletteRotation: number;
  axes: VisualAxes;
}

export interface TrackVisualAnalysis {
  trackId: string;
  status: VisualAnalysisStatus;
  progress: number;
  analysisVersion: number;
  mappingVersion: number;
  sourceSize: number;
  sourceModifiedAt: number;
  contentFingerprint?: string;
  profile?: TrackAudioProfile;
  timeline?: TrackVisualTimeline;
  visualDNA?: TrackVisualDNA;
  error?: string;
  updatedAt: number;
}

export interface VisualAnalysisProgress {
  trackId: string;
  status: VisualAnalysisStatus;
  progress: number;
  message: string;
}

function clampUnit(value: number): number {
  return Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
}

function normalized(value: number, minimum: number, maximum: number): number {
  return clampUnit((value - minimum) / Math.max(1e-9, maximum - minimum));
}

export function hashVisualSeed(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export function createSeededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

export function deriveVisualAxes(profile: Omit<TrackAudioProfile, 'axes'>): VisualAxes {
  const dynamicSpan = Math.max(0, profile.rms.p90 - profile.rms.p10);
  const drive = clampUnit(
    normalized(profile.rms.p90, 0.035, 0.32) * 0.45
      + normalized(profile.onsetRate, 0.2, 5) * 0.32
      + normalized(dynamicSpan, 0.015, 0.2) * 0.23,
  );
  const pulse = clampUnit(
    profile.beatConfidence * 0.68
      + normalized(profile.onsetRate, 0.3, 4.5) * 0.2
      + profile.tempoStability * 0.12,
  );
  const brightness = clampUnit(
    normalized(profile.centroid.p50, 450, 6_500) * 0.65
      + normalized(profile.rolloff.p50, 1_200, 13_000) * 0.35,
  );
  const texture = clampUnit(
    normalized(profile.flatness.p50, 0.015, 0.55) * 0.58
      + profile.entropy.p50 * 0.42,
  );
  const tonality = clampUnit(
    (1 - normalized(profile.flatness.p50, 0.02, 0.5)) * 0.65
      + (1 - profile.entropy.p50) * 0.35,
  );
  const dynamics = clampUnit(
    normalized(dynamicSpan, 0.01, 0.2) * 0.72
      + normalized(profile.peak.p90 - profile.rms.p50, 0.02, 0.75) * 0.28,
  );
  const space = clampUnit(
    (1 - normalized(profile.onsetRate, 0.4, 5)) * 0.45
      + profile.bassRatio * 0.35
      + dynamics * 0.2,
  );
  const complexity = clampUnit(
    normalized(profile.flux.p50, 0.001, 0.08) * 0.38
      + normalized(profile.flux.deviation, 0.001, 0.08) * 0.25
      + normalized(profile.spread.p50, 700, 5_500) * 0.2
      + texture * 0.17,
  );
  return { drive, pulse, brightness, texture, tonality, dynamics, space, complexity };
}

function shapeScores(profile: TrackAudioProfile): Record<VisualShapeFamily, number> {
  const axes = profile.axes;
  return {
    orbital: axes.tonality * 0.36 + axes.space * 0.34 + (1 - axes.drive) * 0.18 + axes.pulse * 0.12,
    bloom: axes.tonality * 0.4 + axes.dynamics * 0.28 + axes.brightness * 0.18 + axes.space * 0.14,
    spiral: profile.bassRatio * 0.42 + axes.pulse * 0.25 + axes.drive * 0.2 + axes.space * 0.13,
    lissajous: axes.tonality * 0.43 + axes.complexity * 0.23 + axes.dynamics * 0.18 + (1 - axes.texture) * 0.16,
    flow: axes.texture * 0.38 + axes.space * 0.25 + axes.complexity * 0.22 + (1 - axes.pulse) * 0.15,
    burst: axes.drive * 0.4 + axes.pulse * 0.33 + axes.brightness * 0.17 + axes.complexity * 0.1,
    constellation: axes.space * 0.38 + (1 - axes.drive) * 0.28 + axes.tonality * 0.2 + axes.complexity * 0.14,
    ribbon: axes.brightness * 0.31 + axes.dynamics * 0.25 + axes.tonality * 0.24 + axes.complexity * 0.2,
  };
}

export function createVisualDNA(profile: TrackAudioProfile, identity: string): TrackVisualDNA {
  const seed = hashVisualSeed(`${identity}:${VISUAL_MAPPING_VERSION}`);
  const random = createSeededRandom(seed);
  const ranked = Object.entries(shapeScores(profile))
    .sort((left, right) => right[1] - left[1]) as Array<[VisualShapeFamily, number]>;
  const [primaryShape, primaryScore] = ranked[0] ?? ['orbital', 1];
  const [secondaryShape, secondaryScore] = ranked[1] ?? ['bloom', 0.5];
  const scoreTotal = Math.max(1e-6, primaryScore + secondaryScore);
  const axes = profile.axes;
  const keyIndex = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B']
    .indexOf(profile.key ?? '');
  return {
    mappingVersion: VISUAL_MAPPING_VERSION,
    seed,
    primaryShape,
    secondaryShape,
    shapeMix: Math.min(0.46, Math.max(0.16, (secondaryScore / scoreTotal) * 0.72)),
    symmetry: Math.max(3, Math.min(12, Math.round(3 + axes.tonality * 5 + random() * 4))),
    rotationDirection: random() < 0.5 ? -1 : 1,
    particleDensity: clampUnit(0.2 + axes.drive * 0.38 + axes.complexity * 0.28 + random() * 0.14),
    particleSize: clampUnit(0.22 + profile.bassRatio * 0.4 + (1 - axes.brightness) * 0.22 + random() * 0.16),
    trail: clampUnit(0.12 + axes.space * 0.36 + axes.tonality * 0.22 + random() * 0.15),
    turbulence: clampUnit(0.08 + axes.texture * 0.52 + axes.complexity * 0.28 + random() * 0.1),
    attraction: clampUnit(0.22 + axes.tonality * 0.38 + profile.bassRatio * 0.24 + random() * 0.12),
    burstPower: clampUnit(0.12 + axes.drive * 0.43 + axes.pulse * 0.35 + random() * 0.08),
    paletteRotation: keyIndex >= 0
      ? (keyIndex / 12 + random() * (profile.keyConfidence < 0.2 ? 0.3 : 0.08)) % 1
      : random(),
    axes,
  };
}

export function createFallbackProfile(): TrackAudioProfile {
  const distribution = (value: number): AudioDistribution => ({
    mean: value,
    p10: value * 0.65,
    p50: value,
    p90: Math.min(1, value * 1.35),
    deviation: value * 0.15,
  });
  const base = {
    analysisVersion: AUDIO_ANALYSIS_VERSION,
    durationMs: 0,
    sampleRate: 44_100,
    frameCount: 0,
    rms: distribution(0.12),
    peak: distribution(0.45),
    centroid: distribution(2_400),
    spread: distribution(1_800),
    rolloff: distribution(5_800),
    flatness: distribution(0.16),
    entropy: distribution(0.55),
    flux: distribution(0.02),
    bandMeans: Array.from({ length: VISUAL_BAND_COUNT }, () => 1 / VISUAL_BAND_COUNT),
    bassRatio: 0.25,
    lowMidRatio: 0.2,
    midRatio: 0.25,
    highMidRatio: 0.18,
    trebleRatio: 0.12,
    onsetRate: 1.4,
    bpm: null,
    beatConfidence: 0,
    tempoStability: 0,
    chromaMeans: Array.from({ length: 12 }, () => 1 / 12),
    key: null,
    mode: null,
    keyConfidence: 0,
  } satisfies Omit<TrackAudioProfile, 'axes'>;
  return { ...base, axes: deriveVisualAxes(base) };
}
