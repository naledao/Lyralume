import FFT from 'fft.js';
import {
  AUDIO_ANALYSIS_VERSION,
  VISUAL_BAND_COUNT,
  deriveVisualAxes,
  type AudioDistribution,
  type AudioFeatureFrame,
  type TrackAudioProfile,
  type TrackVisualSection,
  type TrackVisualTimeline,
  type VisualAxes,
} from './visual-analysis.js';

const MINIMUM_FREQUENCY = 30;
const MAXIMUM_FREQUENCY = 16_000;
const KEY_NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
const MAJOR_KEY_PROFILE = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR_KEY_PROFILE = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

function clampUnit(value: number): number {
  return Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
}

function average(values: readonly number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function percentile(sorted: readonly number[], ratio: number): number {
  if (sorted.length === 0) return 0;
  const position = Math.min(sorted.length - 1, Math.max(0, ratio * (sorted.length - 1)));
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  const progress = position - lower;
  return (sorted[lower] ?? 0) * (1 - progress) + (sorted[upper] ?? 0) * progress;
}

export function distribution(values: readonly number[]): AudioDistribution {
  if (values.length === 0) return { mean: 0, p10: 0, p50: 0, p90: 0, deviation: 0 };
  const sorted = [...values].sort((left, right) => left - right);
  const mean = average(values);
  const deviation = Math.sqrt(average(values.map((value) => (value - mean) ** 2)));
  return {
    mean,
    p10: percentile(sorted, 0.1),
    p50: percentile(sorted, 0.5),
    p90: percentile(sorted, 0.9),
    deviation,
  };
}

function median(values: readonly number[]): number {
  return percentile([...values].sort((left, right) => left - right), 0.5);
}

function logBandEdges(sampleRate: number, fftSize: number): Array<[number, number]> {
  const nyquist = sampleRate / 2;
  const maximum = Math.min(MAXIMUM_FREQUENCY, nyquist);
  const binHz = sampleRate / fftSize;
  return Array.from({ length: VISUAL_BAND_COUNT }, (_, index) => {
    const startHz = MINIMUM_FREQUENCY * (maximum / MINIMUM_FREQUENCY) ** (index / VISUAL_BAND_COUNT);
    const endHz = MINIMUM_FREQUENCY * (maximum / MINIMUM_FREQUENCY) ** ((index + 1) / VISUAL_BAND_COUNT);
    return [
      Math.max(0, Math.floor(startHz / binHz)),
      Math.max(0, Math.ceil(endHz / binHz)),
    ];
  });
}

function bandEnergy(
  spectrum: ArrayLike<number>,
  sampleRate: number,
  fftSize: number,
  minimumHz: number,
  maximumHz: number,
): number {
  const binHz = sampleRate / fftSize;
  const first = Math.max(0, Math.floor(minimumHz / binHz));
  const last = Math.min(spectrum.length - 1, Math.ceil(maximumHz / binHz));
  let sum = 0;
  for (let index = first; index <= last; index += 1) sum += Math.max(0, Number(spectrum[index]) || 0);
  return sum;
}

function chromaFromSpectrum(
  power: ArrayLike<number>,
  sampleRate: number,
  fftSize: number,
): number[] {
  const chroma = Array.from({ length: 12 }, () => 0);
  const binHz = sampleRate / fftSize;
  let total = 0;
  for (let index = 1; index < power.length; index += 1) {
    const frequency = index * binHz;
    if (frequency < 55 || frequency > Math.min(5_000, sampleRate / 2)) continue;
    const midi = Math.round(69 + 12 * Math.log2(frequency / 440));
    const pitchClass = ((midi % 12) + 12) % 12;
    const value = Math.sqrt(Math.max(0, Number(power[index]) || 0)) / Math.sqrt(frequency);
    chroma[pitchClass] += value;
    total += value;
  }
  return total > 1e-9 ? chroma.map((value) => value / total) : chroma;
}

export interface KeyEstimate {
  key: string | null;
  mode: 'major' | 'minor' | null;
  confidence: number;
}

export function estimateMusicalKey(chroma: readonly number[]): KeyEstimate {
  const total = chroma.reduce((sum, value) => sum + Math.max(0, value), 0);
  if (chroma.length !== 12 || total < 1e-9) return { key: null, mode: null, confidence: 0 };
  const normalizedChroma = chroma.map((value) => Math.max(0, value) / total);
  const candidates: Array<{ root: number; mode: 'major' | 'minor'; score: number }> = [];
  for (let root = 0; root < 12; root += 1) {
    for (const [mode, template] of [
      ['major', MAJOR_KEY_PROFILE],
      ['minor', MINOR_KEY_PROFILE],
    ] as const) {
      let score = 0;
      let templateEnergy = 0;
      let chromaEnergy = 0;
      for (let pitch = 0; pitch < 12; pitch += 1) {
        const expected = template[(pitch - root + 12) % 12] ?? 0;
        score += normalizedChroma[pitch] * expected;
        templateEnergy += expected ** 2;
        chromaEnergy += normalizedChroma[pitch] ** 2;
      }
      candidates.push({
        root,
        mode,
        score: score / Math.sqrt(Math.max(1e-9, templateEnergy * chromaEnergy)),
      });
    }
  }
  candidates.sort((left, right) => right.score - left.score);
  const best = candidates[0];
  const second = candidates[1];
  if (!best) return { key: null, mode: null, confidence: 0 };
  return {
    key: KEY_NAMES[best.root] ?? null,
    mode: best.mode,
    confidence: clampUnit(((best.score - (second?.score ?? 0)) / Math.max(0.05, best.score)) * 5),
  };
}

export interface SpectrumFeatureState {
  previousSpectrum?: Float32Array;
  fluxHistory: number[];
  lastOnsetMs: number;
}

export function extractAudioFeatures(
  waveform: ArrayLike<number>,
  magnitudeSpectrum: ArrayLike<number>,
  sampleRate: number,
  fftSize: number,
  timeMs: number,
  state: SpectrumFeatureState,
): AudioFeatureFrame {
  let squared = 0;
  let peak = 0;
  let crossings = 0;
  let previousSample = Number(waveform[0]) || 0;
  for (let index = 0; index < waveform.length; index += 1) {
    const sample = Number(waveform[index]) || 0;
    squared += sample * sample;
    peak = Math.max(peak, Math.abs(sample));
    if (index > 0 && ((sample >= 0 && previousSample < 0) || (sample < 0 && previousSample >= 0))) {
      crossings += 1;
    }
    previousSample = sample;
  }
  const rms = Math.sqrt(squared / Math.max(1, waveform.length));
  const zeroCrossingRate = crossings / Math.max(1, waveform.length - 1);

  const power = new Float32Array(magnitudeSpectrum.length);
  let powerTotal = 0;
  let logSum = 0;
  const epsilon = 1e-12;
  for (let index = 0; index < magnitudeSpectrum.length; index += 1) {
    const value = Math.max(0, Number(magnitudeSpectrum[index]) || 0);
    const item = value * value;
    power[index] = item;
    powerTotal += item;
    logSum += Math.log(item + epsilon);
  }

  const binHz = sampleRate / fftSize;
  let weightedFrequency = 0;
  for (let index = 0; index < power.length; index += 1) {
    weightedFrequency += index * binHz * power[index];
  }
  const spectralCentroid = powerTotal > 0 ? weightedFrequency / powerTotal : 0;
  let spreadSum = 0;
  for (let index = 0; index < power.length; index += 1) {
    spreadSum += ((index * binHz) - spectralCentroid) ** 2 * power[index];
  }
  const spectralSpread = powerTotal > 0 ? Math.sqrt(spreadSum / powerTotal) : 0;
  let cumulative = 0;
  let spectralRolloff = 0;
  for (let index = 0; index < power.length; index += 1) {
    cumulative += power[index];
    if (cumulative >= powerTotal * 0.85) {
      spectralRolloff = index * binHz;
      break;
    }
  }
  const arithmeticMean = powerTotal / Math.max(1, power.length);
  const geometricMean = Math.exp(logSum / Math.max(1, power.length));
  const spectralFlatness = arithmeticMean > epsilon ? clampUnit(geometricMean / arithmeticMean) : 0;
  let spectralEntropy = 0;
  if (powerTotal > epsilon) {
    for (const item of power) {
      const probability = item / powerTotal;
      if (probability > 0) spectralEntropy -= probability * Math.log(probability);
    }
    spectralEntropy /= Math.log(Math.max(2, power.length));
  }

  const normalizedSpectrum = new Float32Array(power.length);
  let spectralFlux = 0;
  for (let index = 0; index < power.length; index += 1) {
    normalizedSpectrum[index] = powerTotal > epsilon ? power[index] / powerTotal : 0;
    const change = normalizedSpectrum[index] - (state.previousSpectrum?.[index] ?? normalizedSpectrum[index]);
    if (change > 0) spectralFlux += change;
  }
  state.previousSpectrum = normalizedSpectrum;
  state.fluxHistory.push(spectralFlux);
  if (state.fluxHistory.length > 96) state.fluxHistory.shift();
  const fluxMedian = median(state.fluxHistory);
  const fluxMad = median(state.fluxHistory.map((value) => Math.abs(value - fluxMedian)));
  const onsetThreshold = fluxMedian + Math.max(0.004, fluxMad * 2.4);
  const onset = spectralFlux > onsetThreshold
    && rms > 0.008
    && timeMs - state.lastOnsetMs >= 80;
  if (onset) state.lastOnsetMs = timeMs;
  const onsetStrength = clampUnit((spectralFlux - fluxMedian) / Math.max(0.01, onsetThreshold));

  const bands = logBandEdges(sampleRate, fftSize).map(([first, last]) => {
    let sum = 0;
    for (let index = first; index <= Math.min(last, power.length - 1); index += 1) sum += power[index];
    return powerTotal > epsilon ? sum / powerTotal : 0;
  });
  const bassPower = bandEnergy(power, sampleRate, fftSize, 30, 250);
  const lowMidPower = bandEnergy(power, sampleRate, fftSize, 250, 800);
  const midPower = bandEnergy(power, sampleRate, fftSize, 800, 2_500);
  const highMidPower = bandEnergy(power, sampleRate, fftSize, 2_500, 6_000);
  const treblePower = bandEnergy(power, sampleRate, fftSize, 6_000, Math.min(16_000, sampleRate / 2));
  const audiblePower = bassPower + lowMidPower + midPower + highMidPower + treblePower;
  const ratio = (value: number): number => audiblePower > epsilon ? value / audiblePower : 0;
  const chroma = chromaFromSpectrum(power, sampleRate, fftSize);

  return {
    timeMs,
    rms,
    peak,
    energy: clampUnit(Math.max(rms * 3.2, onsetStrength * 0.45)),
    bands,
    chroma,
    bass: ratio(bassPower),
    lowMid: ratio(lowMidPower),
    mid: ratio(midPower),
    highMid: ratio(highMidPower),
    treble: ratio(treblePower),
    spectralCentroid,
    spectralSpread,
    spectralRolloff,
    spectralFlatness,
    spectralEntropy: clampUnit(spectralEntropy),
    spectralFlux,
    zeroCrossingRate,
    onset,
    onsetStrength,
  };
}

interface TempoEstimate {
  bpm: number | null;
  confidence: number;
  stability: number;
  beatsMs: number[];
}

function estimateTempo(frames: readonly AudioFeatureFrame[], hopMs: number): TempoEstimate {
  if (frames.length < 32 || hopMs <= 0) {
    return { bpm: null, confidence: 0, stability: 0, beatsMs: [] };
  }
  const envelope = frames.map((frame) => frame.onsetStrength);
  const mean = average(envelope);
  const centered = envelope.map((value) => value - mean);
  const minimumLag = Math.max(1, Math.floor(60_000 / 200 / hopMs));
  const maximumLag = Math.min(centered.length - 2, Math.ceil(60_000 / 55 / hopMs));
  let bestLag = 0;
  let bestScore = 0;
  let scoreTotal = 0;
  for (let lag = minimumLag; lag <= maximumLag; lag += 1) {
    let correlation = 0;
    let leftEnergy = 0;
    let rightEnergy = 0;
    for (let index = lag; index < centered.length; index += 1) {
      correlation += centered[index] * centered[index - lag];
      leftEnergy += centered[index] ** 2;
      rightEnergy += centered[index - lag] ** 2;
    }
    const score = Math.max(0, correlation / Math.sqrt(Math.max(1e-9, leftEnergy * rightEnergy)));
    scoreTotal += score;
    if (score > bestScore) {
      bestScore = score;
      bestLag = lag;
    }
  }
  if (bestLag === 0 || bestScore < 0.08) {
    return { bpm: null, confidence: 0, stability: 0, beatsMs: [] };
  }
  let bestPhase = 0;
  let bestPhaseScore = -1;
  for (let phase = 0; phase < bestLag; phase += 1) {
    let phaseScore = 0;
    for (let index = phase; index < envelope.length; index += bestLag) phaseScore += envelope[index];
    if (phaseScore > bestPhaseScore) {
      bestPhase = phase;
      bestPhaseScore = phaseScore;
    }
  }
  const beatsMs: number[] = [];
  const searchRadius = Math.max(1, Math.floor(bestLag * 0.16));
  for (let target = bestPhase; target < envelope.length; target += bestLag) {
    let selected = target;
    for (
      let candidate = Math.max(0, target - searchRadius);
      candidate <= Math.min(envelope.length - 1, target + searchRadius);
      candidate += 1
    ) {
      if (envelope[candidate] > envelope[selected]) selected = candidate;
    }
    const timeMs = frames[selected]?.timeMs ?? selected * hopMs;
    if (beatsMs.length === 0 || timeMs - beatsMs.at(-1)! > hopMs * 2) beatsMs.push(timeMs);
  }
  const intervals = beatsMs.slice(1).map((time, index) => time - beatsMs[index]);
  const intervalMean = average(intervals);
  const intervalDeviation = intervals.length > 0
    ? Math.sqrt(average(intervals.map((value) => (value - intervalMean) ** 2)))
    : intervalMean;
  return {
    bpm: 60_000 / (bestLag * hopMs),
    confidence: clampUnit(bestScore * 0.72 + (bestScore / Math.max(1e-6, scoreTotal)) * 2.5),
    stability: intervalMean > 0 ? clampUnit(1 - intervalDeviation / intervalMean) : 0,
    beatsMs,
  };
}

function axesFromFrames(frames: readonly AudioFeatureFrame[], sampleRate: number): VisualAxes {
  if (frames.length === 0) {
    return { drive: 0, pulse: 0, brightness: 0, texture: 0, tonality: 0, dynamics: 0, space: 0, complexity: 0 };
  }
  const profile = profileFromFrames(frames, sampleRate, 0, false);
  return profile.axes;
}

function createSections(frames: readonly AudioFeatureFrame[], durationMs: number, sampleRate: number): TrackVisualSection[] {
  if (frames.length === 0 || durationMs <= 0) return [];
  const bucketMs = 1_000;
  const buckets: AudioFeatureFrame[][] = [];
  for (const frame of frames) {
    const index = Math.floor(frame.timeMs / bucketMs);
    (buckets[index] ??= []).push(frame);
  }
  const vectors = buckets.map((bucket) => {
    if (!bucket || bucket.length === 0) return [0, 0, 0, 0, 0];
    return [
      average(bucket.map((frame) => frame.energy)),
      average(bucket.map((frame) => frame.bass)),
      average(bucket.map((frame) => frame.spectralCentroid)) / Math.max(1, sampleRate / 2),
      average(bucket.map((frame) => frame.spectralFlatness)),
      average(bucket.map((frame) => frame.spectralFlux)),
    ];
  });
  const novelty = vectors.map((vector, index) => {
    if (index === 0) return 0;
    const previous = vectors[index - 1] ?? vector;
    return Math.sqrt(vector.reduce((sum, value, feature) => sum + (value - previous[feature]) ** 2, 0));
  });
  const noveltyMedian = median(novelty);
  const noveltyMad = median(novelty.map((value) => Math.abs(value - noveltyMedian)));
  const boundaries = [0];
  for (let index = 6; index < novelty.length - 4; index += 1) {
    const isLocalPeak = novelty[index] >= Math.max(...novelty.slice(index - 2, index + 3));
    if (isLocalPeak
      && novelty[index] > noveltyMedian + Math.max(0.03, noveltyMad * 2.2)
      && index - boundaries.at(-1)! >= 6) {
      boundaries.push(index);
    }
  }
  if (Math.ceil(durationMs / bucketMs) - boundaries.at(-1)! < 5 && boundaries.length > 1) {
    boundaries.pop();
  }
  boundaries.push(Math.ceil(durationMs / bucketMs));
  return boundaries.slice(0, -1).map((startBucket, index) => {
    const endBucket = boundaries[index + 1];
    const sectionFrames: AudioFeatureFrame[] = [];
    for (let bucket = startBucket; bucket < endBucket; bucket += 1) {
      if (buckets[bucket]) sectionFrames.push(...buckets[bucket]);
    }
    return {
      id: `section-${index + 1}`,
      startMs: startBucket * bucketMs,
      endMs: Math.min(durationMs, endBucket * bucketMs),
      axes: axesFromFrames(sectionFrames, sampleRate),
    };
  });
}

function profileFromFrames(
  frames: readonly AudioFeatureFrame[],
  sampleRate: number,
  durationMs: number,
  includeTempo: boolean,
): TrackAudioProfile {
  const frameDuration = frames.length > 1
    ? ((frames.at(-1)?.timeMs ?? 0) - (frames[0]?.timeMs ?? 0)) / (frames.length - 1)
    : 0;
  const tempo = includeTempo
    ? estimateTempo(frames, frameDuration)
    : { bpm: null, confidence: 0, stability: 0, beatsMs: [] };
  const bandMeans = Array.from({ length: VISUAL_BAND_COUNT }, (_, band) => (
    average(frames.map((frame) => frame.bands[band] ?? 0))
  ));
  const chromaMeans = Array.from({ length: 12 }, (_, pitch) => (
    average(frames.map((frame) => frame.chroma[pitch] ?? 0))
  ));
  const musicalKey = estimateMusicalKey(chromaMeans);
  const base = {
    analysisVersion: AUDIO_ANALYSIS_VERSION,
    durationMs,
    sampleRate,
    frameCount: frames.length,
    rms: distribution(frames.map((frame) => frame.rms)),
    peak: distribution(frames.map((frame) => frame.peak)),
    centroid: distribution(frames.map((frame) => frame.spectralCentroid)),
    spread: distribution(frames.map((frame) => frame.spectralSpread)),
    rolloff: distribution(frames.map((frame) => frame.spectralRolloff)),
    flatness: distribution(frames.map((frame) => frame.spectralFlatness)),
    entropy: distribution(frames.map((frame) => frame.spectralEntropy)),
    flux: distribution(frames.map((frame) => frame.spectralFlux)),
    bandMeans,
    bassRatio: average(frames.map((frame) => frame.bass)),
    lowMidRatio: average(frames.map((frame) => frame.lowMid)),
    midRatio: average(frames.map((frame) => frame.mid)),
    highMidRatio: average(frames.map((frame) => frame.highMid)),
    trebleRatio: average(frames.map((frame) => frame.treble)),
    onsetRate: durationMs > 0
      ? frames.filter((frame) => frame.onset).length / (durationMs / 1_000)
      : 0,
    bpm: tempo.bpm,
    beatConfidence: tempo.confidence,
    tempoStability: tempo.stability,
    chromaMeans,
    key: musicalKey.key,
    mode: musicalKey.mode,
    keyConfidence: musicalKey.confidence,
  } satisfies Omit<TrackAudioProfile, 'axes'>;
  return { ...base, axes: deriveVisualAxes(base) };
}

export interface CompletedAudioAnalysis {
  profile: TrackAudioProfile;
  timeline: TrackVisualTimeline;
}

export class StreamingAudioAnalyzer {
  readonly fftSize: number;
  readonly hopSize: number;
  private readonly fft: FFT;
  private readonly window: Float64Array;
  private readonly input: Float64Array;
  private readonly spectrum: Float64Array;
  private readonly state: SpectrumFeatureState = { fluxHistory: [], lastOnsetMs: Number.NEGATIVE_INFINITY };
  private pending = new Float32Array(0);
  private processedSamples = 0;
  private readonly frames: AudioFeatureFrame[] = [];

  constructor(
    readonly sampleRate: number,
    options: { fftSize?: number; hopSize?: number } = {},
  ) {
    this.fftSize = options.fftSize ?? 2_048;
    this.hopSize = options.hopSize ?? 512;
    this.fft = new FFT(this.fftSize);
    this.window = Float64Array.from({ length: this.fftSize }, (_, index) => (
      0.5 - 0.5 * Math.cos((2 * Math.PI * index) / (this.fftSize - 1))
    ));
    this.input = new Float64Array(this.fftSize);
    this.spectrum = new Float64Array(this.fftSize * 2);
  }

  push(samples: Float32Array): void {
    if (samples.length === 0) return;
    const combined = new Float32Array(this.pending.length + samples.length);
    combined.set(this.pending);
    combined.set(samples, this.pending.length);
    let offset = 0;
    while (offset + this.fftSize <= combined.length) {
      const frame = combined.subarray(offset, offset + this.fftSize);
      for (let index = 0; index < this.fftSize; index += 1) {
        this.input[index] = frame[index] * this.window[index];
      }
      this.fft.realTransform(this.spectrum, this.input);
      const magnitudes = new Float64Array(this.fftSize / 2);
      for (let index = 0; index < magnitudes.length; index += 1) {
        magnitudes[index] = Math.hypot(this.spectrum[index * 2], this.spectrum[index * 2 + 1]);
      }
      this.frames.push(extractAudioFeatures(
        frame,
        magnitudes,
        this.sampleRate,
        this.fftSize,
        (this.processedSamples / this.sampleRate) * 1_000,
        this.state,
      ));
      offset += this.hopSize;
      this.processedSamples += this.hopSize;
    }
    this.pending = combined.slice(offset);
  }

  finish(durationMs = (this.processedSamples / this.sampleRate) * 1_000): CompletedAudioAnalysis {
    const profile = profileFromFrames(this.frames, this.sampleRate, durationMs, true);
    const tempo = estimateTempo(
      this.frames,
      this.frames.length > 1
        ? ((this.frames.at(-1)?.timeMs ?? 0) - (this.frames[0]?.timeMs ?? 0))
          / (this.frames.length - 1)
        : 0,
    );
    return {
      profile,
      timeline: {
        beatsMs: tempo.beatsMs,
        sections: createSections(this.frames, durationMs, this.sampleRate),
      },
    };
  }
}
