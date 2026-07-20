export interface LyricParticleBounds {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface LyricParticle {
  x: number;
  y: number;
  velocityX: number;
  velocityY: number;
  size: number;
  ageMs: number;
  lifetimeMs: number;
  maximumAlpha: number;
  colorIndex: 0 | 1;
}

export const MAX_LYRIC_PARTICLES = 80;
export const TEXT_SAFE_DISTANCE_PX = 10;

function clampUnit(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function randomBetween(random: () => number, minimum: number, maximum: number): number {
  return minimum + (maximum - minimum) * random();
}

function particleAlpha(energy: number, random: () => number): number {
  return Math.min(0.3, 0.12 + clampUnit(energy) * 0.15 + random() * 0.025);
}

export function getLyricBurstParticleCount(energy: number): number {
  return 20 + Math.round(clampUnit(energy) * 10);
}

export function getLyricProgressEmissionRate(energy: number, treble: number): number {
  return 2 + clampUnit(energy) * 2 + clampUnit(treble) * 6;
}

export function createLyricBurstParticle(
  bounds: LyricParticleBounds,
  energy: number,
  random: () => number = Math.random,
): LyricParticle {
  const side = Math.min(3, Math.floor(random() * 4));
  const horizontalPosition = bounds.left + random() * bounds.width;
  const verticalPosition = bounds.top + random() * bounds.height;
  const normalSpeed = randomBetween(random, 0.018, 0.052);
  const tangentSpeed = randomBetween(random, -0.022, 0.022);
  let x = horizontalPosition;
  let y = bounds.top - TEXT_SAFE_DISTANCE_PX;
  let velocityX = tangentSpeed;
  let velocityY = -normalSpeed;

  if (side === 1) {
    x = bounds.left + bounds.width + TEXT_SAFE_DISTANCE_PX;
    y = verticalPosition;
    velocityX = normalSpeed;
    velocityY = tangentSpeed;
  } else if (side === 2) {
    y = bounds.top + bounds.height + TEXT_SAFE_DISTANCE_PX;
    velocityY = normalSpeed;
  } else if (side === 3) {
    x = bounds.left - TEXT_SAFE_DISTANCE_PX;
    y = verticalPosition;
    velocityX = -normalSpeed;
    velocityY = tangentSpeed;
  }

  return {
    x,
    y,
    velocityX,
    velocityY,
    size: randomBetween(random, 0.8, 2.25),
    ageMs: 0,
    lifetimeMs: randomBetween(random, 620, 940),
    maximumAlpha: particleAlpha(energy, random),
    colorIndex: random() > 0.72 ? 1 : 0,
  };
}

export function createLyricProgressParticle(
  bounds: LyricParticleBounds,
  progress: number,
  energy: number,
  random: () => number = Math.random,
): LyricParticle {
  const fromTop = random() > 0.72;
  const x = bounds.left + bounds.width * clampUnit(progress) + randomBetween(random, -3.5, 3.5);
  const normalSpeed = randomBetween(random, 0.014, 0.038);
  return {
    x,
    y: fromTop
      ? bounds.top - TEXT_SAFE_DISTANCE_PX
      : bounds.top + bounds.height + TEXT_SAFE_DISTANCE_PX,
    velocityX: randomBetween(random, -0.014, 0.014),
    velocityY: fromTop ? -normalSpeed : normalSpeed,
    size: randomBetween(random, 0.7, 1.8),
    ageMs: 0,
    lifetimeMs: randomBetween(random, 520, 820),
    maximumAlpha: particleAlpha(energy, random),
    colorIndex: random() > 0.66 ? 1 : 0,
  };
}

export function advanceLyricParticles(
  particles: LyricParticle[],
  deltaMs: number,
): void {
  const safeDeltaMs = Math.min(50, Math.max(0, deltaMs));
  const damping = Math.pow(0.988, safeDeltaMs / (1_000 / 60));
  let writeIndex = 0;
  for (const particle of particles) {
    particle.ageMs += safeDeltaMs;
    if (particle.ageMs >= particle.lifetimeMs) continue;
    particle.x += particle.velocityX * safeDeltaMs;
    particle.y += particle.velocityY * safeDeltaMs;
    particle.velocityX *= damping;
    particle.velocityY *= damping;
    particles[writeIndex] = particle;
    writeIndex += 1;
  }
  particles.length = writeIndex;
}

export function getLyricParticleOpacity(particle: LyricParticle): number {
  const progress = clampUnit(particle.ageMs / particle.lifetimeMs);
  const fadeIn = Math.min(1, progress / 0.12);
  const fadeOut = Math.pow(1 - progress, 1.65);
  return particle.maximumAlpha * fadeIn * fadeOut;
}
