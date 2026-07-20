import { describe, expect, it } from 'vitest';
import type {
  TrackVisualDNA,
  TrackVisualTimeline,
  VisualAxes,
} from '../../shared/visual-analysis';
import {
  buildVisualCues,
  sampleVisualDirector,
  type VisualCue,
} from './visualDirector';

function axes(overrides: Partial<VisualAxes> = {}): VisualAxes {
  return {
    drive: 0.45,
    pulse: 0.55,
    brightness: 0.5,
    texture: 0.4,
    tonality: 0.6,
    dynamics: 0.5,
    space: 0.45,
    complexity: 0.5,
    ...overrides,
  };
}

const dna: TrackVisualDNA = {
  mappingVersion: 2,
  seed: 0x12345678,
  primaryShape: 'orbital',
  secondaryShape: 'bloom',
  shapeMix: 0.3,
  symmetry: 6,
  rotationDirection: 1,
  particleDensity: 0.5,
  particleSize: 0.5,
  trail: 0.4,
  turbulence: 0.35,
  attraction: 0.55,
  burstPower: 0.65,
  paletteRotation: 0.2,
  axes: axes(),
};

describe('visual cue director', () => {
  it('builds a deterministic four-beat phrase and a drop for a rising section', () => {
    const timeline: TrackVisualTimeline = {
      beatsMs: [0, 500, 1_000, 1_500],
      sections: [
        { id: 'intro', startMs: 0, endMs: 900, axes: axes({ drive: 0.2, pulse: 0.3 }) },
        { id: 'chorus', startMs: 900, endMs: 2_000, axes: axes({ drive: 0.8, pulse: 0.85 }) },
      ],
    };

    const first = buildVisualCues(timeline, dna);
    const second = buildVisualCues(timeline, dna);
    const beatCues = first.filter((cue) => ['downbeat', 'push', 'accent', 'rebound'].includes(cue.kind));

    expect(second).toEqual(first);
    expect(beatCues.map((cue) => cue.kind)).toEqual([
      'downbeat',
      'push',
      'accent',
      'rebound',
    ]);
    expect(first).toContainEqual(expect.objectContaining({ kind: 'drop', timeMs: 900 }));
  });

  it('normalizes invalid, duplicate, and unordered beat times', () => {
    const cues = buildVisualCues({
      beatsMs: [1_000.4, 500, Number.NaN, -10, 500.2],
      sections: [],
    }, dna);

    expect(cues.map((cue) => cue.timeMs)).toEqual([500, 1_000]);
    expect(cues.map((cue) => cue.kind)).toEqual(['downbeat', 'push']);
  });

  it('samples an attack and release without keeping state across seeks', () => {
    const cue: VisualCue = {
      id: 'downbeat:1000:0',
      kind: 'downbeat',
      timeMs: 1_000,
      intensity: 1,
      direction: 1,
      attackMs: 100,
      holdMs: 0,
      releaseMs: 100,
    };

    const active = sampleVisualDirector([cue], 1_050);
    expect(active.zoom).toBeGreaterThan(0);
    expect(active.burst).toBeGreaterThan(0);
    expect(sampleVisualDirector([cue], 1_250)).toEqual({
      zoom: 0,
      rotation: 0,
      offsetX: 0,
      offsetY: 0,
      glow: 0,
      burst: 0,
    });
    expect(sampleVisualDirector([cue], 1_050)).toEqual(active);
  });

  it('preserves light response while suppressing virtual camera motion', () => {
    const cue: VisualCue = {
      id: 'accent:0:0',
      kind: 'accent',
      timeMs: 0,
      intensity: 1,
      direction: 1,
      attackMs: 1,
      holdMs: 100,
      releaseMs: 100,
    };
    const full = sampleVisualDirector([cue], 50);
    const reduced = sampleVisualDirector([cue], 50, true);

    expect(full.rotation).not.toBe(0);
    expect(reduced.rotation).toBe(0);
    expect(reduced.zoom).toBeLessThan(full.zoom);
    expect(reduced.glow).toBeGreaterThan(0);
    expect(reduced.burst).toBeLessThan(full.burst);
  });
});
