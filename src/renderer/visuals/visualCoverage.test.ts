import { describe, expect, it } from 'vitest';
import { mixParticleCoverage, visualGeometryScale } from './visualCoverage';

describe('immersive visual coverage', () => {
  it('uses most of the immersive stage before audio expansion', () => {
    expect(visualGeometryScale('immersive', 1_000, 0, 0, 0)).toBe(430);
    expect(visualGeometryScale('compact', 1_000, 0, 0, 0)).toBe(270);
  });

  it('can distribute field particles to every edge of the stage', () => {
    expect(mixParticleCoverage(100, 80, 0.98, -0.98, 1, 1_200, 1_000)).toEqual({
      x: 588,
      y: -490,
    });
  });
});
