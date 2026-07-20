import { describe, expect, it } from 'vitest';
import {
  advanceLyricParticles,
  createLyricBurstParticle,
  createLyricProgressParticle,
  getLyricBurstParticleCount,
  getLyricParticleOpacity,
  getLyricProgressEmissionRate,
  TEXT_SAFE_DISTANCE_PX,
  type LyricParticleBounds,
} from './lyricParticles';

const bounds: LyricParticleBounds = {
  left: 100,
  top: 80,
  width: 320,
  height: 72,
};

function seededRandom(): () => number {
  let seed = 42;
  return () => {
    seed = (seed * 1_664_525 + 1_013_904_223) >>> 0;
    return seed / 0x1_0000_0000;
  };
}

function isInsideProtectedTextArea(x: number, y: number): boolean {
  return x > bounds.left - TEXT_SAFE_DISTANCE_PX
    && x < bounds.left + bounds.width + TEXT_SAFE_DISTANCE_PX
    && y > bounds.top - TEXT_SAFE_DISTANCE_PX
    && y < bounds.top + bounds.height + TEXT_SAFE_DISTANCE_PX;
}

describe('lyricParticles', () => {
  it('spawns entry particles outside the protected text area', () => {
    const random = seededRandom();
    for (let index = 0; index < 200; index += 1) {
      const particle = createLyricBurstParticle(bounds, 0.7, random);
      expect(isInsideProtectedTextArea(particle.x, particle.y)).toBe(false);
      expect(particle.maximumAlpha).toBeLessThanOrEqual(0.3);
    }
  });

  it('keeps progress particles near the cue front and outside the text', () => {
    const random = seededRandom();
    const particle = createLyricProgressParticle(bounds, 0.4, 0.5, random);
    const expectedX = bounds.left + bounds.width * 0.4;

    expect(Math.abs(particle.x - expectedX)).toBeLessThanOrEqual(3.5);
    expect(isInsideProtectedTextArea(particle.x, particle.y)).toBe(false);
  });

  it('caps intensity inputs and removes expired particles', () => {
    expect(getLyricBurstParticleCount(10)).toBe(30);
    expect(getLyricProgressEmissionRate(10, 10)).toBe(10);
    const particle = createLyricBurstParticle(bounds, 1, seededRandom());
    particle.ageMs = particle.lifetimeMs - 10;
    const particles = [particle];

    advanceLyricParticles(particles, 20);

    expect(particles).toHaveLength(0);
  });

  it('fades particles in and then out without exceeding their alpha limit', () => {
    const particle = createLyricBurstParticle(bounds, 0.8, seededRandom());
    particle.ageMs = particle.lifetimeMs * 0.08;
    const enteringOpacity = getLyricParticleOpacity(particle);
    particle.ageMs = particle.lifetimeMs * 0.75;
    const leavingOpacity = getLyricParticleOpacity(particle);

    expect(enteringOpacity).toBeGreaterThan(0);
    expect(leavingOpacity).toBeGreaterThan(0);
    expect(enteringOpacity).toBeLessThanOrEqual(particle.maximumAlpha);
    expect(leavingOpacity).toBeLessThanOrEqual(particle.maximumAlpha);
  });
});
