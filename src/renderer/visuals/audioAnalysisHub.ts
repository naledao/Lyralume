import { gsap } from 'gsap';
import {
  extractAudioFeatures,
  type SpectrumFeatureState,
} from '../../shared/audio-dsp';
import type { AudioFeatureFrame } from '../../shared/visual-analysis';
import { audioEngine } from '../audio/AudioEngine';

export interface AudioAnalysisFrame extends AudioFeatureFrame {
  animationTimeMs: number;
  timeMs: number;
  deltaMs: number;
}

type AudioAnalysisListener = (frame: AudioAnalysisFrame) => void;

function smoothEnvelope(previous: number, next: number): number {
  const amount = next > previous ? 0.32 : 0.09;
  return previous + (next - previous) * amount;
}

class AudioAnalysisHub {
  private readonly listeners = new Set<AudioAnalysisListener>();
  private floatFrequencyData = new Float32Array(1_024);
  private floatWaveformData = new Float32Array(2_048);
  private magnitudeSpectrum = new Float32Array(1_024);
  private readonly featureState: SpectrumFeatureState = {
    fluxHistory: [],
    lastOnsetMs: Number.NEGATIVE_INFINITY,
  };
  private running = false;
  private energy = 0;
  private bass = 0;
  private lowMid = 0;
  private mid = 0;
  private highMid = 0;
  private treble = 0;
  private lastPlaybackTimeMs: number | null = null;
  private lastSourceGeneration = -1;

  subscribe(listener: AudioAnalysisListener): () => void {
    this.listeners.add(listener);
    if (!this.running) {
      this.running = true;
      gsap.ticker.add(this.tick);
    }
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0 && this.running) {
        gsap.ticker.remove(this.tick);
        this.running = false;
      }
    };
  }

  private readonly tick = (timeSeconds: number, deltaMs: number): void => {
    if (document.hidden) return;
    const analyser = audioEngine.getAnalyser();
    const playbackTimeMs = audioEngine.getPlaybackSnapshot().currentTime * 1_000;
    const sourceGeneration = audioEngine.getSourceGeneration();
    if (sourceGeneration !== this.lastSourceGeneration || (this.lastPlaybackTimeMs !== null && (
      playbackTimeMs < this.lastPlaybackTimeMs - 80
      || playbackTimeMs - this.lastPlaybackTimeMs > 1_000
    ))) this.resetFeatureHistory();
    this.lastSourceGeneration = sourceGeneration;
    this.lastPlaybackTimeMs = playbackTimeMs;
    let features: AudioFeatureFrame = {
      timeMs: playbackTimeMs,
      rms: 0,
      peak: 0,
      energy: 0,
      bands: Array.from({ length: 32 }, () => 0),
      chroma: Array.from({ length: 12 }, () => 0),
      bass: 0,
      lowMid: 0,
      mid: 0,
      highMid: 0,
      treble: 0,
      spectralCentroid: 0,
      spectralSpread: 0,
      spectralRolloff: 0,
      spectralFlatness: 0,
      spectralEntropy: 0,
      spectralFlux: 0,
      zeroCrossingRate: 0,
      onset: false,
      onsetStrength: 0,
    };

    if (analyser) {
      if (this.floatFrequencyData.length !== analyser.frequencyBinCount) {
        this.floatFrequencyData = new Float32Array(analyser.frequencyBinCount);
        this.magnitudeSpectrum = new Float32Array(analyser.frequencyBinCount);
      }
      if (this.floatWaveformData.length !== analyser.fftSize) {
        this.floatWaveformData = new Float32Array(analyser.fftSize);
      }
      analyser.getFloatFrequencyData(this.floatFrequencyData);
      analyser.getFloatTimeDomainData(this.floatWaveformData);
      for (let index = 0; index < this.floatFrequencyData.length; index += 1) {
        const decibels = this.floatFrequencyData[index];
        this.magnitudeSpectrum[index] = Number.isFinite(decibels)
          ? 10 ** (decibels / 20)
          : 0;
      }
      features = extractAudioFeatures(
        this.floatWaveformData,
        this.magnitudeSpectrum,
        analyser.context.sampleRate,
        analyser.fftSize,
        features.timeMs,
        this.featureState,
      );
    } else {
      this.floatFrequencyData.fill(-96);
      this.floatWaveformData.fill(0);
      this.magnitudeSpectrum.fill(0);
    }

    this.energy = smoothEnvelope(this.energy, features.energy);
    this.bass = smoothEnvelope(this.bass, features.bass);
    this.lowMid = smoothEnvelope(this.lowMid, features.lowMid);
    this.mid = smoothEnvelope(this.mid, features.mid);
    this.highMid = smoothEnvelope(this.highMid, features.highMid);
    this.treble = smoothEnvelope(this.treble, features.treble);
    const frame: AudioAnalysisFrame = {
      ...features,
      animationTimeMs: timeSeconds * 1_000,
      deltaMs: Math.min(50, Math.max(0, deltaMs)),
      energy: this.energy,
      bass: this.bass,
      lowMid: this.lowMid,
      mid: this.mid,
      highMid: this.highMid,
      treble: this.treble,
    };

    for (const listener of this.listeners) {
      try {
        listener(frame);
      } catch (error) {
        this.listeners.delete(listener);
        console.warn('An audio analysis subscriber was safely stopped', error);
      }
    }
    if (this.listeners.size === 0 && this.running) {
      gsap.ticker.remove(this.tick);
      this.running = false;
    }
  };

  private resetFeatureHistory(): void {
    this.featureState.previousSpectrum = undefined;
    this.featureState.fluxHistory.length = 0;
    this.featureState.lastOnsetMs = Number.NEGATIVE_INFINITY;
    this.energy = 0;
    this.bass = 0;
    this.lowMid = 0;
    this.mid = 0;
    this.highMid = 0;
    this.treble = 0;
  }
}

export const audioAnalysisHub = new AudioAnalysisHub();
