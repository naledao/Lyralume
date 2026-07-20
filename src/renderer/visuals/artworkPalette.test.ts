import { describe, expect, it } from 'vitest';
import {
  contrastRatio,
  createImmersiveTheme,
  createVisualizerPalette,
  extractArtworkPalette,
  type ArtworkPalette,
  type RgbColor,
} from './artworkPalette';

function pixelData(entries: Array<{ color: RgbColor; count: number; alpha?: number }>): Uint8ClampedArray {
  return new Uint8ClampedArray(entries.flatMap(({ color, count, alpha = 255 }) => (
    Array.from({ length: count }, () => [...color, alpha]).flat()
  )));
}

function containsColor(
  palette: ReturnType<typeof extractArtworkPalette>,
  expected: RgbColor,
): boolean {
  return palette.some(({ color }) => (
    Math.abs(color[0] - expected[0]) < 8
      && Math.abs(color[1] - expected[1]) < 8
      && Math.abs(color[2] - expected[2]) < 8
  ));
}

describe('artwork palette extraction', () => {
  it('retains every visually distinct color cluster and its approximate share', () => {
    const palette = extractArtworkPalette(pixelData([
      { color: [230, 30, 35], count: 60 },
      { color: [25, 205, 90], count: 30 },
      { color: [35, 80, 225], count: 10 },
      { color: [255, 0, 255], count: 20, alpha: 0 },
    ]));

    expect(palette).toHaveLength(3);
    expect(containsColor(palette, [230, 30, 35])).toBe(true);
    expect(containsColor(palette, [25, 205, 90])).toBe(true);
    expect(containsColor(palette, [35, 80, 225])).toBe(true);
    expect(palette[0].weight).toBeCloseTo(0.6, 2);
  });

  it('merges imperceptibly close shades instead of treating compression noise as colors', () => {
    const palette = extractArtworkPalette(pixelData([
      { color: [120, 82, 62], count: 50 },
      { color: [124, 85, 65], count: 50 },
    ]));

    expect(palette).toHaveLength(1);
    expect(containsColor(palette, [122, 84, 64])).toBe(true);
  });

  it('falls back safely when the image has no visible pixels', () => {
    expect(extractArtworkPalette(pixelData([
      { color: [255, 0, 0], count: 5, alpha: 0 },
    ]))).toHaveLength(2);
  });
});

describe('visualizer palette distribution', () => {
  it('gives every recognized artwork color at least one of the 72 bars', () => {
    const palette: ArtworkPalette = [
      { color: [6, 8, 12], weight: 0.7 },
      { color: [190, 180, 165], weight: 0.18 },
      { color: [38, 155, 73], weight: 0.08 },
      { color: [32, 190, 205], weight: 0.04 },
    ];
    const visualizerPalette = createVisualizerPalette(palette);
    const distinctColors = new Set(visualizerPalette.barColors.map((color) => color.join(',')));

    expect(visualizerPalette.barColors).toHaveLength(72);
    expect(distinctColors.size).toBe(4);
    expect(visualizerPalette.glowColors).toHaveLength(6);
  });
});

describe('immersive theme', () => {
  it('keeps artwork-derived lyric colors readable on the generated dark background', () => {
    const theme = createImmersiveTheme([
      { color: [16, 19, 24], weight: 0.72 },
      { color: [185, 54, 38], weight: 0.18 },
      { color: [38, 74, 192], weight: 0.1 },
    ]);

    expect(contrastRatio(theme.accent, theme.background)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(theme.accentSecondary, theme.background)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(theme.activeText, theme.background)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(theme.translationText, theme.background)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(theme.mutedText, theme.background)).toBeGreaterThanOrEqual(4.5);
  });

  it('falls back to the Lyralume palette when artwork colors are unavailable', () => {
    const theme = createImmersiveTheme([]);

    expect(theme.background).toHaveLength(3);
    expect(theme.accent).toHaveLength(3);
    expect(contrastRatio(theme.activeText, theme.background)).toBeGreaterThanOrEqual(4.5);
  });
});
