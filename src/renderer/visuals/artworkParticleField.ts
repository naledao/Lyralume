export interface ArtworkParticleField {
  count: number;
  x: Float32Array;
  y: Float32Array;
  strength: Float32Array;
  colors: Uint8ClampedArray;
}

interface ArtworkPointCandidate {
  pixelX: number;
  pixelY: number;
  red: number;
  green: number;
  blue: number;
  score: number;
  tieBreaker: number;
}

const DEFAULT_MAX_POINTS = 720;
const COVERAGE_GRID_SIZE = 10;
const MINIMUM_POINT_SCORE = 0.026;

function clampUnit(value: number): number {
  return Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
}

export function artworkMorphTarget({
  available,
  playing,
  reducedMotion,
  sectionDrive,
  sectionSpace,
  burstDrive,
}: {
  available: boolean;
  playing: boolean;
  reducedMotion: boolean;
  sectionDrive: number;
  sectionSpace: number;
  burstDrive: number;
}): number {
  if (!available) return 0;
  if (reducedMotion) return 0.82;
  if (!playing) return 0.76;
  return Math.min(0.82, Math.max(
    0.12,
    0.3
      + clampUnit(sectionSpace) * 0.3
      + (1 - clampUnit(sectionDrive)) * 0.24
      - clampUnit(burstDrive) * 0.34,
  ));
}

function pixelTieBreaker(x: number, y: number): number {
  let value = Math.imul(x + 1, 0x45d9f3b) ^ Math.imul(y + 1, 0x119de1f3);
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
  return (value ^ (value >>> 16)) >>> 0;
}

function candidateSort(left: ArtworkPointCandidate, right: ArtworkPointCandidate): number {
  return right.score - left.score || left.tieBreaker - right.tieBreaker;
}

function candidateKey(candidate: ArtworkPointCandidate): number {
  return candidate.pixelY * 65_536 + candidate.pixelX;
}

/**
 * Extracts a small, deterministic edge/texture field from decoded artwork.
 * Coordinates are normalized to -1..1 and retain sampled colors so the render
 * loop never needs to read pixels or allocate image data per frame.
 */
export function extractArtworkParticleField(
  pixels: ArrayLike<number>,
  width: number,
  height: number,
  maxPoints = DEFAULT_MAX_POINTS,
): ArtworkParticleField | null {
  const safeWidth = Math.max(0, Math.floor(width));
  const safeHeight = Math.max(0, Math.floor(height));
  const pointLimit = Math.max(0, Math.floor(maxPoints));
  if (
    safeWidth < 2
    || safeHeight < 2
    || pointLimit === 0
    || pixels.length < safeWidth * safeHeight * 4
  ) return null;

  const luminance = new Float32Array(safeWidth * safeHeight);
  const alpha = new Float32Array(safeWidth * safeHeight);
  for (let index = 0; index < luminance.length; index += 1) {
    const pixelIndex = index * 4;
    const red = Number(pixels[pixelIndex]) || 0;
    const green = Number(pixels[pixelIndex + 1]) || 0;
    const blue = Number(pixels[pixelIndex + 2]) || 0;
    luminance[index] = (red * 0.2126 + green * 0.7152 + blue * 0.0722) / 255;
    alpha[index] = clampUnit((Number(pixels[pixelIndex + 3]) || 0) / 255);
  }

  const gridWidth = Math.min(COVERAGE_GRID_SIZE, safeWidth);
  const gridHeight = Math.min(COVERAGE_GRID_SIZE, safeHeight);
  const cells = Array.from(
    { length: gridWidth * gridHeight },
    (): ArtworkPointCandidate[] => [],
  );
  const candidates: ArtworkPointCandidate[] = [];
  const sampleLuminance = (x: number, y: number): number => {
    if (x < 0 || y < 0 || x >= safeWidth || y >= safeHeight) return 0;
    const index = y * safeWidth + x;
    return luminance[index] * alpha[index];
  };

  for (let y = 0; y < safeHeight; y += 1) {
    for (let x = 0; x < safeWidth; x += 1) {
      const index = y * safeWidth + x;
      const pixelAlpha = alpha[index];
      if (pixelAlpha < 0.18) continue;
      const pixelIndex = index * 4;
      const red = Number(pixels[pixelIndex]) || 0;
      const green = Number(pixels[pixelIndex + 1]) || 0;
      const blue = Number(pixels[pixelIndex + 2]) || 0;
      const maximum = Math.max(red, green, blue);
      const minimum = Math.min(red, green, blue);
      const saturation = maximum === 0 ? 0 : (maximum - minimum) / maximum;
      const horizontal = sampleLuminance(x + 1, y) - sampleLuminance(x - 1, y);
      const vertical = sampleLuminance(x, y + 1) - sampleLuminance(x, y - 1);
      const diagonal = Math.abs(
        sampleLuminance(x + 1, y + 1) - sampleLuminance(x - 1, y - 1),
      ) + Math.abs(
        sampleLuminance(x - 1, y + 1) - sampleLuminance(x + 1, y - 1),
      );
      const edge = Math.hypot(horizontal, vertical) * 0.58 + diagonal * 0.18;
      const isBorder = x === 0 || y === 0 || x === safeWidth - 1 || y === safeHeight - 1;
      const border = isBorder ? 0.08 + luminance[index] * 0.18 : 0;
      const score = (edge * 0.78 + saturation * 0.075 + border) * pixelAlpha;
      if (score < MINIMUM_POINT_SCORE) continue;
      const candidate: ArtworkPointCandidate = {
        pixelX: x,
        pixelY: y,
        red,
        green,
        blue,
        score,
        tieBreaker: pixelTieBreaker(x, y),
      };
      candidates.push(candidate);
      const cellX = Math.min(gridWidth - 1, Math.floor((x / safeWidth) * gridWidth));
      const cellY = Math.min(gridHeight - 1, Math.floor((y / safeHeight) * gridHeight));
      cells[cellY * gridWidth + cellX].push(candidate);
    }
  }

  if (candidates.length === 0) return null;
  const selected: ArtworkPointCandidate[] = [];
  const selectedKeys = new Set<number>();
  const perCell = Math.max(1, Math.ceil(pointLimit / cells.length));
  for (const cell of cells) {
    cell.sort(candidateSort);
    for (let index = 0; index < Math.min(perCell, cell.length); index += 1) {
      const candidate = cell[index];
      selected.push(candidate);
      selectedKeys.add(candidateKey(candidate));
    }
  }
  if (selected.length < pointLimit) {
    candidates.sort(candidateSort);
    for (const candidate of candidates) {
      if (selected.length >= pointLimit) break;
      const key = candidateKey(candidate);
      if (selectedKeys.has(key)) continue;
      selected.push(candidate);
      selectedKeys.add(key);
    }
  }
  selected.sort(candidateSort);
  if (selected.length > pointLimit) selected.length = pointLimit;

  const maximumScore = selected[0]?.score ?? 1;
  const count = selected.length;
  const field: ArtworkParticleField = {
    count,
    x: new Float32Array(count),
    y: new Float32Array(count),
    strength: new Float32Array(count),
    colors: new Uint8ClampedArray(count * 3),
  };
  for (let index = 0; index < count; index += 1) {
    const candidate = selected[index];
    field.x[index] = ((candidate.pixelX + 0.5) / safeWidth) * 2 - 1;
    field.y[index] = ((candidate.pixelY + 0.5) / safeHeight) * 2 - 1;
    field.strength[index] = clampUnit(candidate.score / maximumScore);
    const colorIndex = index * 3;
    field.colors[colorIndex] = candidate.red;
    field.colors[colorIndex + 1] = candidate.green;
    field.colors[colorIndex + 2] = candidate.blue;
  }
  return field;
}
