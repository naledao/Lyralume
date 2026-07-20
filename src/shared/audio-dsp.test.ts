import { describe, expect, it } from 'vitest';
import { StreamingAudioAnalyzer, distribution, estimateMusicalKey } from './audio-dsp';

function sineWave(frequency: number, seconds: number, sampleRate = 44_100): Float32Array {
  return Float32Array.from({ length: Math.round(seconds * sampleRate) }, (_, index) => (
    Math.sin((2 * Math.PI * frequency * index) / sampleRate) * 0.4
  ));
}

function clickTrack(bpm: number, seconds: number, sampleRate = 44_100): Float32Array {
  const samples = new Float32Array(Math.round(seconds * sampleRate));
  const interval = Math.round((60 / bpm) * sampleRate);
  const clickLength = Math.round(sampleRate * 0.012);
  for (let start = 0; start < samples.length; start += interval) {
    for (let offset = 0; offset < clickLength && start + offset < samples.length; offset += 1) {
      samples[start + offset] = Math.sin((2 * Math.PI * 1_800 * offset) / sampleRate)
        * (1 - offset / clickLength) * 0.8;
    }
  }
  return samples;
}

describe('audio DSP', () => {
  it('computes stable distributions', () => {
    expect(distribution([1, 2, 3, 4, 5])).toMatchObject({ mean: 3, p50: 3 });
  });

  it('locates the centroid of a sine wave near its frequency', () => {
    const analyzer = new StreamingAudioAnalyzer(44_100);
    analyzer.push(sineWave(1_000, 0.5));
    const result = analyzer.finish(500);
    expect(result.profile.centroid.p50).toBeGreaterThan(930);
    expect(result.profile.centroid.p50).toBeLessThan(1_070);
    expect(result.profile.flatness.p50).toBeLessThan(0.05);
  });

  it('does not emit invalid values for silence', () => {
    const analyzer = new StreamingAudioAnalyzer(44_100);
    analyzer.push(new Float32Array(44_100));
    const result = analyzer.finish(1_000);
    expect(result.profile.rms.mean).toBe(0);
    expect(result.profile.axes.drive).toBeGreaterThanOrEqual(0);
    expect(result.profile.axes.drive).toBeLessThanOrEqual(1);
  });

  it('estimates a musical key from a chroma profile', () => {
    const chroma = [0, 0.25, 0, 0, 0.25, 0, 0, 0, 0, 0.5, 0, 0];
    expect(estimateMusicalKey(chroma)).toMatchObject({ key: 'A', mode: 'major' });
  });

  it('estimates tempo and a beat timeline from regular transients', () => {
    const analyzer = new StreamingAudioAnalyzer(44_100);
    analyzer.push(clickTrack(120, 8));
    const result = analyzer.finish(8_000);
    expect(result.profile.bpm).toBeGreaterThan(116);
    expect(result.profile.bpm).toBeLessThan(124);
    expect(result.timeline.beatsMs.length).toBeGreaterThan(10);
  });
});
