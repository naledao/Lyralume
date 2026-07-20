import { describe, expect, it } from 'vitest';
import {
  artworkMorphTarget,
  extractArtworkParticleField,
} from './artworkParticleField';

function imagePixels(
  width: number,
  height: number,
  colorAt: (x: number, y: number) => readonly [number, number, number, number],
): Uint8ClampedArray {
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const color = colorAt(x, y);
      const index = (y * width + x) * 4;
      pixels[index] = color[0];
      pixels[index + 1] = color[1];
      pixels[index + 2] = color[2];
      pixels[index + 3] = color[3];
    }
  }
  return pixels;
}

describe('artwork particle field', () => {
  it('reveals artwork in calm sections and releases it on energetic bursts', () => {
    const calm = artworkMorphTarget({
      available: true,
      playing: true,
      reducedMotion: false,
      sectionDrive: 0.15,
      sectionSpace: 0.8,
      burstDrive: 0,
    });
    const burst = artworkMorphTarget({
      available: true,
      playing: true,
      reducedMotion: false,
      sectionDrive: 0.9,
      sectionSpace: 0.2,
      burstDrive: 1,
    });

    expect(calm).toBeGreaterThan(burst);
    expect(artworkMorphTarget({
      available: true,
      playing: true,
      reducedMotion: true,
      sectionDrive: 1,
      sectionSpace: 0,
      burstDrive: 1,
    })).toBe(0.82);
    expect(artworkMorphTarget({
      available: false,
      playing: true,
      reducedMotion: false,
      sectionDrive: 0,
      sectionSpace: 1,
      burstDrive: 0,
    })).toBe(0);
  });

  it('rejects missing geometry and fully transparent artwork', () => {
    expect(extractArtworkParticleField(new Uint8ClampedArray(), 0, 0)).toBeNull();
    expect(extractArtworkParticleField(
      imagePixels(8, 8, () => [255, 255, 255, 0]),
      8,
      8,
    )).toBeNull();
  });

  it('finds a strong internal artwork edge and preserves sampled colors', () => {
    const field = extractArtworkParticleField(
      imagePixels(12, 8, (x) => (x < 6 ? [12, 18, 28, 255] : [240, 220, 80, 255])),
      12,
      8,
      40,
    );

    expect(field).not.toBeNull();
    expect(field!.count).toBeGreaterThan(0);
    expect(field!.count).toBeLessThanOrEqual(40);
    expect(Array.from(field!.x).some((x) => Math.abs(x) < 0.28)).toBe(true);
    expect(Array.from(field!.colors).some((channel) => channel >= 220)).toBe(true);
    expect(Array.from(field!.strength).every((value) => value >= 0 && value <= 1)).toBe(true);
  });

  it('is deterministic, bounded, and keeps coverage across textured artwork', () => {
    const pixels = imagePixels(20, 20, (x, y) => (
      (x + y) % 2 === 0 ? [230, 60, 170, 255] : [20, 180, 220, 255]
    ));
    const first = extractArtworkParticleField(pixels, 20, 20, 64);
    const second = extractArtworkParticleField(pixels, 20, 20, 64);

    expect(first).not.toBeNull();
    expect(first!.count).toBe(64);
    expect(Array.from(second!.x)).toEqual(Array.from(first!.x));
    expect(Array.from(second!.y)).toEqual(Array.from(first!.y));
    expect(Array.from(second!.colors)).toEqual(Array.from(first!.colors));
    expect(Math.min(...first!.x)).toBeLessThan(-0.5);
    expect(Math.max(...first!.x)).toBeGreaterThan(0.5);
    expect(Math.min(...first!.y)).toBeLessThan(-0.5);
    expect(Math.max(...first!.y)).toBeGreaterThan(0.5);
  });
});
