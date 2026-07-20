export type RgbColor = readonly [red: number, green: number, blue: number];

export interface ArtworkPaletteColor {
  color: RgbColor;
  weight: number;
}

export type ArtworkPalette = readonly ArtworkPaletteColor[];

export interface VisualizerPalette {
  barColors: RgbColor[];
  glowColors: RgbColor[];
}

export interface ImmersiveTheme {
  background: RgbColor;
  backgroundAlt: RgbColor;
  accent: RgbColor;
  accentSecondary: RgbColor;
  activeText: RgbColor;
  translationText: RgbColor;
  mutedText: RgbColor;
}

interface ColorBucket {
  red: number;
  green: number;
  blue: number;
  count: number;
}

interface HslColor {
  hue: number;
  saturation: number;
  lightness: number;
}

const MAX_PALETTE_COLORS = 32;
const BAR_COLOR_COUNT = 72;
const GLOW_COLOR_COUNT = 6;

export const DEFAULT_ARTWORK_PALETTE: ArtworkPalette = [
  { color: [157, 139, 255], weight: 0.68 },
  { color: [87, 231, 213], weight: 0.32 },
];

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function rgbToHsl([redByte, greenByte, blueByte]: RgbColor): HslColor {
  const red = redByte / 255;
  const green = greenByte / 255;
  const blue = blueByte / 255;
  const maximum = Math.max(red, green, blue);
  const minimum = Math.min(red, green, blue);
  const delta = maximum - minimum;
  const lightness = (maximum + minimum) / 2;
  if (delta === 0) return { hue: 0, saturation: 0, lightness };

  const saturation = delta / (1 - Math.abs(2 * lightness - 1));
  let hue: number;
  if (maximum === red) hue = 60 * (((green - blue) / delta) % 6);
  else if (maximum === green) hue = 60 * ((blue - red) / delta + 2);
  else hue = 60 * ((red - green) / delta + 4);
  if (hue < 0) hue += 360;
  return { hue, saturation, lightness };
}

function hslToRgb({ hue, saturation, lightness }: HslColor): RgbColor {
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const section = hue / 60;
  const intermediate = chroma * (1 - Math.abs((section % 2) - 1));
  let red = 0;
  let green = 0;
  let blue = 0;
  if (section < 1) [red, green] = [chroma, intermediate];
  else if (section < 2) [red, green] = [intermediate, chroma];
  else if (section < 3) [green, blue] = [chroma, intermediate];
  else if (section < 4) [green, blue] = [intermediate, chroma];
  else if (section < 5) [red, blue] = [intermediate, chroma];
  else [red, blue] = [chroma, intermediate];
  const match = lightness - chroma / 2;
  return [
    Math.round((red + match) * 255),
    Math.round((green + match) * 255),
    Math.round((blue + match) * 255),
  ];
}

function colorBucketKey(color: RgbColor): string {
  const { hue, saturation, lightness } = rgbToHsl(color);
  if (saturation < 0.1) return `neutral:${Math.min(11, Math.floor(lightness * 12))}`;
  return [
    Math.min(19, Math.floor(hue / 18)),
    Math.min(4, Math.floor(saturation * 5)),
    Math.min(7, Math.floor(lightness * 8)),
  ].join(':');
}

function averageColor(bucket: ColorBucket): RgbColor {
  return [
    Math.round(bucket.red / bucket.count),
    Math.round(bucket.green / bucket.count),
    Math.round(bucket.blue / bucket.count),
  ];
}

// A red-mean distance keeps the merge inexpensive while accounting for human RGB sensitivity.
function colorDistance(left: RgbColor, right: RgbColor): number {
  const redMean = (left[0] + right[0]) / 2;
  const red = left[0] - right[0];
  const green = left[1] - right[1];
  const blue = left[2] - right[2];
  return Math.sqrt(
    (2 + redMean / 256) * red * red
      + 4 * green * green
      + (2 + (255 - redMean) / 256) * blue * blue,
  );
}

function addToBucket(bucket: ColorBucket, color: RgbColor, amount: number): void {
  bucket.red += color[0] * amount;
  bucket.green += color[1] * amount;
  bucket.blue += color[2] * amount;
  bucket.count += amount;
}

export function extractArtworkPalette(pixels: ArrayLike<number>): ArtworkPalette {
  const histogram = new Map<string, ColorBucket>();
  let totalWeight = 0;

  for (let index = 0; index + 3 < pixels.length; index += 4) {
    const alpha = Number(pixels[index + 3]) / 255;
    if (alpha < 0.18) continue;
    const color: RgbColor = [
      Number(pixels[index]),
      Number(pixels[index + 1]),
      Number(pixels[index + 2]),
    ];
    const key = colorBucketKey(color);
    const bucket = histogram.get(key) ?? { red: 0, green: 0, blue: 0, count: 0 };
    addToBucket(bucket, color, alpha);
    histogram.set(key, bucket);
    totalWeight += alpha;
  }

  if (totalWeight === 0) return DEFAULT_ARTWORK_PALETTE;

  const minimumClusterWeight = Math.max(0.9, totalWeight * 0.0015);
  let candidates = [...histogram.values()]
    .filter((bucket) => bucket.count >= minimumClusterWeight)
    .sort((left, right) => right.count - left.count);
  if (candidates.length === 0) {
    const strongest = [...histogram.values()].sort((left, right) => right.count - left.count)[0];
    if (strongest) candidates = [strongest];
  }

  const merged: ColorBucket[] = [];
  for (const candidate of candidates) {
    const candidateColor = averageColor(candidate);
    let closest: ColorBucket | undefined;
    let closestDistance = Number.POSITIVE_INFINITY;
    for (const cluster of merged) {
      const distance = colorDistance(candidateColor, averageColor(cluster));
      if (distance < closestDistance) {
        closest = cluster;
        closestDistance = distance;
      }
    }
    if (closest && closestDistance < 30) {
      closest.red += candidate.red;
      closest.green += candidate.green;
      closest.blue += candidate.blue;
      closest.count += candidate.count;
    } else {
      merged.push({ ...candidate });
    }
  }

  const retained = merged
    .sort((left, right) => right.count - left.count)
    .slice(0, MAX_PALETTE_COLORS);
  const retainedWeight = retained.reduce((sum, bucket) => sum + bucket.count, 0);
  if (retainedWeight === 0) return DEFAULT_ARTWORK_PALETTE;
  return retained.map((bucket) => ({
    color: averageColor(bucket),
    weight: bucket.count / retainedWeight,
  }));
}

function visibleOnDarkBackground(color: RgbColor): RgbColor {
  const hsl = rgbToHsl(color);
  hsl.lightness = clamp(hsl.lightness, 0.26, 0.88);
  if (hsl.saturation >= 0.1) hsl.saturation = Math.max(0.3, hsl.saturation);
  return hslToRgb(hsl);
}

function linearizeChannel(channel: number): number {
  const normalized = channel / 255;
  return normalized <= 0.04045
    ? normalized / 12.92
    : ((normalized + 0.055) / 1.055) ** 2.4;
}

function relativeLuminance(color: RgbColor): number {
  return linearizeChannel(color[0]) * 0.2126
    + linearizeChannel(color[1]) * 0.7152
    + linearizeChannel(color[2]) * 0.0722;
}

export function contrastRatio(left: RgbColor, right: RgbColor): number {
  const brighter = Math.max(relativeLuminance(left), relativeLuminance(right));
  const darker = Math.min(relativeLuminance(left), relativeLuminance(right));
  return (brighter + 0.05) / (darker + 0.05);
}

function ensureContrast(
  color: RgbColor,
  background: RgbColor,
  targetRatio: number,
): RgbColor {
  if (contrastRatio(color, background) >= targetRatio) return color;
  const white: RgbColor = [255, 255, 255];
  const black: RgbColor = [0, 0, 0];
  const destination = contrastRatio(white, background) >= contrastRatio(black, background)
    ? white
    : black;
  for (let step = 1; step <= 20; step += 1) {
    const candidate = mixColor(color, destination, step / 20);
    if (contrastRatio(candidate, background) >= targetRatio) return candidate;
  }
  return destination;
}

function allocateColors(palette: ArtworkPalette, count: number): number[] {
  const usable = palette.slice(0, count);
  const allocations = usable.map(() => 1);
  let remaining = count - usable.length;
  const weightTotal = usable.reduce((sum, entry) => sum + entry.weight, 0) || 1;
  const fractions = usable.map((entry, index) => {
    const exact = (entry.weight / weightTotal) * remaining;
    const whole = Math.floor(exact);
    allocations[index] += whole;
    return { index, fraction: exact - whole };
  });
  remaining -= allocations.reduce((sum, allocation) => sum + allocation, 0) - usable.length;
  fractions.sort((left, right) => right.fraction - left.fraction);
  for (let index = 0; index < remaining; index += 1) {
    allocations[fractions[index % fractions.length].index] += 1;
  }
  return allocations;
}

function evenlyDistributeColors(colors: RgbColor[], allocations: number[]): RgbColor[] {
  const total = allocations.reduce((sum, allocation) => sum + allocation, 0);
  const currentScores = allocations.map(() => 0);
  const remaining = [...allocations];
  const result: RgbColor[] = [];
  for (let slot = 0; slot < total; slot += 1) {
    let selected = -1;
    for (let index = 0; index < allocations.length; index += 1) {
      if (remaining[index] === 0) continue;
      currentScores[index] += allocations[index];
      if (selected < 0 || currentScores[index] > currentScores[selected]) selected = index;
    }
    if (selected < 0) break;
    currentScores[selected] -= total;
    remaining[selected] -= 1;
    result.push(colors[selected]);
  }
  return result;
}

export function createVisualizerPalette(palette: ArtworkPalette): VisualizerPalette {
  const source = palette.length > 0 ? palette : DEFAULT_ARTWORK_PALETTE;
  const usableSource = source.slice(0, MAX_PALETTE_COLORS);
  const visibleColors = usableSource
    .map((entry) => visibleOnDarkBackground(entry.color));
  const allocations = allocateColors(usableSource, BAR_COLOR_COUNT);
  const barColors = evenlyDistributeColors(visibleColors, allocations);
  const glowColors = visibleColors.slice(0, GLOW_COLOR_COUNT);
  while (glowColors.length < GLOW_COLOR_COUNT) {
    glowColors.push(barColors[Math.floor((glowColors.length / GLOW_COLOR_COUNT) * barColors.length)]);
  }
  return { barColors, glowColors };
}

function mixColor(from: RgbColor, to: RgbColor, progress: number): RgbColor {
  return [
    Math.round(from[0] + (to[0] - from[0]) * progress),
    Math.round(from[1] + (to[1] - from[1]) * progress),
    Math.round(from[2] + (to[2] - from[2]) * progress),
  ];
}

export function createImmersiveTheme(palette: ArtworkPalette): ImmersiveTheme {
  const source = palette.length > 0 ? palette : DEFAULT_ARTWORK_PALETTE;
  const dominant = source[0]?.color ?? DEFAULT_ARTWORK_PALETTE[0].color;
  const rankedAccents = [...source].sort((left, right) => {
    const leftHsl = rgbToHsl(left.color);
    const rightHsl = rgbToHsl(right.color);
    const leftScore = leftHsl.saturation * 0.72 + left.weight * 0.28;
    const rightScore = rightHsl.saturation * 0.72 + right.weight * 0.28;
    return rightScore - leftScore;
  });
  const primarySource = rankedAccents[0]?.color ?? DEFAULT_ARTWORK_PALETTE[0].color;
  const secondarySource = rankedAccents[1]?.color
    ?? DEFAULT_ARTWORK_PALETTE[1].color
    ?? primarySource;
  const background = mixColor(dominant, [4, 7, 13], 0.86);
  const backgroundAlt = mixColor(secondarySource, [7, 10, 18], 0.9);
  const accent = ensureContrast(visibleOnDarkBackground(primarySource), background, 4.5);
  const accentSecondary = ensureContrast(
    visibleOnDarkBackground(secondarySource),
    background,
    4.5,
  );
  return {
    background,
    backgroundAlt,
    accent,
    accentSecondary,
    activeText: ensureContrast(mixColor(accent, [255, 255, 255], 0.4), background, 4.5),
    translationText: ensureContrast(
      mixColor(accentSecondary, [255, 255, 255], 0.24),
      background,
      4.5,
    ),
    mutedText: ensureContrast(mixColor(background, [255, 255, 255], 0.5), background, 4.5),
  };
}

export function interpolateVisualizerPalette(
  from: VisualizerPalette,
  to: VisualizerPalette,
  progress: number,
): VisualizerPalette {
  const amount = clamp(progress, 0, 1);
  return {
    barColors: to.barColors.map((color, index) => (
      mixColor(from.barColors[index] ?? color, color, amount)
    )),
    glowColors: to.glowColors.map((color, index) => (
      mixColor(from.glowColors[index] ?? color, color, amount)
    )),
  };
}
