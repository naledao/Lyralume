import { describe, expect, it } from 'vitest';
import { createFallbackProfile, createVisualDNA, type VisualShapeFamily } from '../../shared/visual-analysis';
import { sampleVisualShape } from './visualGeometry';

describe('visual geometry', () => {
  it('returns finite normalized coordinates for every shape family', () => {
    const dna = createVisualDNA(createFallbackProfile(), 'geometry-test');
    const families: VisualShapeFamily[] = [
      'orbital',
      'bloom',
      'spiral',
      'lissajous',
      'flow',
      'burst',
      'constellation',
      'ribbon',
    ];
    for (const family of families) {
      for (let index = 0; index < 50; index += 1) {
        const point = sampleVisualShape(family, index / 50, dna, 1.5);
        expect(Number.isFinite(point.x)).toBe(true);
        expect(Number.isFinite(point.y)).toBe(true);
        expect(Math.abs(point.x)).toBeLessThanOrEqual(1.2);
        expect(Math.abs(point.y)).toBeLessThanOrEqual(1.2);
      }
    }
  });
});
