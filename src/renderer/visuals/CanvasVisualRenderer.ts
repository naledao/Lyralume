import { gsap } from 'gsap';
import type { TrackVisualDNA, TrackVisualTimeline } from '../../shared/visual-analysis';
import type { VisualQuality } from '../store/useAppStore';
import { AdaptiveQualityController } from './adaptiveQuality';
import {
  interpolateVisualizerPalette,
  type RgbColor,
  type VisualizerPalette,
} from './artworkPalette';
import {
  artworkMorphTarget,
  type ArtworkParticleField,
} from './artworkParticleField';
import { audioAnalysisHub, type AudioAnalysisFrame } from './audioAnalysisHub';
import { sampleVisualDNA } from './visualGeometry';
import {
  mixParticleCoverage,
  visualGeometryScale,
  type CanvasVisualVariant,
} from './visualCoverage';
import {
  buildVisualCues,
  NEUTRAL_VISUAL_DIRECTOR_FRAME,
  sampleVisualDirector,
  type VisualCue,
} from './visualDirector';
import { crossedBeat, currentVisualSection } from './visualTimeline';

interface ParticleState {
  count: number;
  phase: Float32Array;
  speed: Float32Array;
  size: Float32Array;
  alpha: Float32Array;
  drift: Float32Array;
  driftPhase: Float32Array;
  layerScale: Float32Array;
  fieldMix: Float32Array;
  fieldX: Float32Array;
  fieldY: Float32Array;
  artworkIndex: Uint32Array;
  artworkAffinity: Float32Array;
  band: Uint8Array;
  previousX: Float32Array;
  previousY: Float32Array;
}

interface PaletteTransition {
  from: VisualizerPalette;
  to: VisualizerPalette;
  startedAt: number;
}

export interface CanvasVisualRendererOptions {
  canvas: HTMLCanvasElement;
  variant: CanvasVisualVariant;
  dna: TrackVisualDNA;
  timeline?: TrackVisualTimeline;
  artworkField?: ArtworkParticleField;
  palette: VisualizerPalette;
  quality: VisualQuality;
  intensity: number;
  reducedMotion: boolean;
  isPlaying(): boolean;
  onFailure(): void;
}

const PALETTE_TRANSITION_MS = 560;
const COMPACT_CANVAS_PIXEL_BUDGET = 2_600_000;
const IMMERSIVE_CANVAS_PIXEL_BUDGET = 3_200_000;
const QUALITY_MULTIPLIER: Record<VisualQuality, number> = {
  eco: 0.55,
  balanced: 1,
  high: 1.25,
};
const QUALITY_PIXEL_MULTIPLIER: Record<VisualQuality, number> = {
  eco: 0.58,
  balanced: 1,
  high: 1.15,
};

function transitionProgress(transition: PaletteTransition, time: number): number {
  const linear = Math.min(1, Math.max(0, (time - transition.startedAt) / PALETTE_TRANSITION_MS));
  return 1 - (1 - linear) ** 3;
}

function rgbaBetween(
  from: RgbColor,
  to: RgbColor,
  progress: number,
  alpha: number,
  artworkRed = 0,
  artworkGreen = 0,
  artworkBlue = 0,
  artworkMix = 0,
): string {
  const mix = Math.min(1, Math.max(0, artworkMix));
  const baseRed = from[0] + (to[0] - from[0]) * progress;
  const baseGreen = from[1] + (to[1] - from[1]) * progress;
  const baseBlue = from[2] + (to[2] - from[2]) * progress;
  const red = Math.round(baseRed + (artworkRed - baseRed) * mix);
  const green = Math.round(baseGreen + (artworkGreen - baseGreen) * mix);
  const blue = Math.round(baseBlue + (artworkBlue - baseBlue) * mix);
  return `rgba(${red}, ${green}, ${blue}, ${Math.min(1, Math.max(0, alpha))})`;
}

function createParticles(
  dna: TrackVisualDNA,
  variant: CanvasVisualVariant,
  quality: VisualQuality,
  artworkField: ArtworkParticleField | undefined,
): ParticleState {
  const base = variant === 'immersive' ? 270 : 80;
  const range = variant === 'immersive' ? 430 : 130;
  const count = Math.round((base + dna.particleDensity * range) * QUALITY_MULTIPLIER[quality]);
  const phase = new Float32Array(count);
  const speed = new Float32Array(count);
  const size = new Float32Array(count);
  const alpha = new Float32Array(count);
  const drift = new Float32Array(count);
  const driftPhase = new Float32Array(count);
  const layerScale = new Float32Array(count);
  const fieldMix = new Float32Array(count);
  const fieldX = new Float32Array(count);
  const fieldY = new Float32Array(count);
  const artworkIndex = new Uint32Array(count);
  const artworkAffinity = new Float32Array(count);
  const band = new Uint8Array(count);
  const previousX = new Float32Array(count);
  const previousY = new Float32Array(count);
  previousX.fill(Number.NaN);
  previousY.fill(Number.NaN);
  let state = (dna.seed ^ (variant === 'immersive' ? 0xa53c9e1d : 0x23b95f47)) >>> 0;
  const random = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
  for (let index = 0; index < count; index += 1) {
    phase[index] = (index / count + random() * 0.045) % 1;
    speed[index] = (0.000004 + random() * 0.000018) * dna.rotationDirection;
    size[index] = (variant === 'immersive' ? 0.75 : 0.58) + random() * (1.1 + dna.particleSize * 2.4);
    alpha[index] = 0.16 + random() * 0.62;
    drift[index] = 0.006 + random() * 0.04;
    driftPhase[index] = random() * Math.PI * 2;
    layerScale[index] = variant === 'immersive' ? 0.7 + random() * 0.94 : 0.9 + random() * 0.18;
    const fieldParticle = variant === 'immersive' && random() < 0.38;
    fieldMix[index] = fieldParticle ? 0.68 + random() * 0.24 : random() * 0.08;
    fieldX[index] = random() * 1.96 - 0.98;
    fieldY[index] = random() * 1.96 - 0.98;
    artworkIndex[index] = artworkField?.count
      ? Math.floor(random() * artworkField.count)
      : 0;
    artworkAffinity[index] = artworkField?.count
      ? (variant === 'immersive' ? 0.62 : 0.44) + random() * 0.38
      : 0;
    band[index] = Math.floor(random() * 32);
  }
  return {
    count,
    phase,
    speed,
    size,
    alpha,
    drift,
    driftPhase,
    layerScale,
    fieldMix,
    fieldX,
    fieldY,
    artworkIndex,
    artworkAffinity,
    band,
    previousX,
    previousY,
  };
}

export class CanvasVisualRenderer {
  private readonly context: CanvasRenderingContext2D;
  private readonly particles: ParticleState;
  private readonly cues: VisualCue[];
  private readonly hasDirectedBeatTimeline: boolean;
  private readonly resizeObserver: ResizeObserver;
  private readonly visual = {
    energy: 0.04,
    bass: 0.04,
    mid: 0.04,
    treble: 0.04,
    onset: 0,
    artwork: 0,
  };
  private readonly easeEnergy = gsap.quickTo(this.visual, 'energy', { duration: 0.18, ease: 'power2.out' });
  private readonly easeBass = gsap.quickTo(this.visual, 'bass', { duration: 0.15, ease: 'power2.out' });
  private readonly easeMid = gsap.quickTo(this.visual, 'mid', { duration: 0.2, ease: 'power2.out' });
  private readonly easeTreble = gsap.quickTo(this.visual, 'treble', { duration: 0.11, ease: 'power2.out' });
  private readonly easeArtwork = gsap.quickTo(this.visual, 'artwork', { duration: 0.72, ease: 'power2.inOut' });
  private paletteTransition: PaletteTransition;
  private unsubscribe?: () => void;
  private width = 1;
  private height = 1;
  private lastPlaybackTimeMs = 0;
  private lastTickerTimeMs: number | null = null;
  private lastDrawTimeMs: number | null = null;
  private renderAccumulatorMs = 0;
  private needsResize = false;
  private readonly adaptiveQuality = new AdaptiveQualityController();
  private stopped = false;

  constructor(private readonly options: CanvasVisualRendererOptions) {
    const context = options.canvas.getContext('2d');
    if (!context) throw new Error('Canvas 2D unavailable');
    this.context = context;
    this.particles = createParticles(
      options.dna,
      options.variant,
      options.quality,
      options.artworkField,
    );
    this.cues = buildVisualCues(options.timeline, options.dna);
    this.hasDirectedBeatTimeline = this.cues.some((cue) => (
      cue.kind === 'downbeat'
      || cue.kind === 'push'
      || cue.kind === 'accent'
      || cue.kind === 'rebound'
    ));
    this.paletteTransition = {
      from: options.palette,
      to: options.palette,
      startedAt: performance.now(),
    };
    this.resizeObserver = new ResizeObserver(() => this.resize());
  }

  start(): void {
    this.resizeObserver.observe(this.options.canvas);
    this.resize();
    this.unsubscribe = audioAnalysisHub.subscribe(this.draw);
  }

  setPalette(palette: VisualizerPalette): void {
    const now = performance.now();
    this.paletteTransition = {
      from: interpolateVisualizerPalette(
        this.paletteTransition.from,
        this.paletteTransition.to,
        transitionProgress(this.paletteTransition, now),
      ),
      to: palette,
      startedAt: now,
    };
  }

  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    this.resizeObserver.disconnect();
    this.easeEnergy.tween.kill();
    this.easeBass.tween.kill();
    this.easeMid.tween.kill();
    this.easeTreble.tween.kill();
    this.easeArtwork.tween.kill();
    this.context.clearRect(0, 0, this.width, this.height);
  }

  private resize(): void {
    const bounds = this.options.canvas.getBoundingClientRect();
    const cssPixels = Math.max(1, bounds.width * bounds.height);
    const baseBudget = this.options.variant === 'immersive'
      ? IMMERSIVE_CANVAS_PIXEL_BUDGET
      : COMPACT_CANVAS_PIXEL_BUDGET;
    const adaptivePixelScale = 0.35 + this.adaptiveQuality.scale * 0.65;
    const pixelBudget = baseBudget
      * QUALITY_PIXEL_MULTIPLIER[this.options.quality]
      * adaptivePixelScale;
    const maximumDpr = this.options.variant === 'immersive' ? 1.25 : 2;
    const scale = Math.max(0.55, Math.min(
      window.devicePixelRatio || 1,
      maximumDpr,
      Math.sqrt(pixelBudget / cssPixels),
    ));
    const nextWidth = Math.max(1, Math.round(bounds.width * scale));
    const nextHeight = Math.max(1, Math.round(bounds.height * scale));
    if (nextWidth === this.width && nextHeight === this.height) return;
    this.width = nextWidth;
    this.height = nextHeight;
    this.options.canvas.width = this.width;
    this.options.canvas.height = this.height;
    this.particles.previousX.fill(Number.NaN);
    this.particles.previousY.fill(Number.NaN);
  }

  private readonly draw = (frame: AudioAnalysisFrame): void => {
    if (this.stopped) return;
    try {
      this.renderFrame(frame);
    } catch {
      this.stop();
      this.options.onFailure();
    }
  };

  private renderFrame(frame: AudioAnalysisFrame): void {
    const { dna, timeline, variant, quality, intensity, reducedMotion } = this.options;
    const animationTime = frame.animationTimeMs;
    const targetFrameInterval = quality === 'eco' ? 1_000 / 30 : 1_000 / 60;
    const tickerDeltaMs = this.lastTickerTimeMs === null
      ? targetFrameInterval
      : Math.min(100, Math.max(0, animationTime - this.lastTickerTimeMs));
    this.lastTickerTimeMs = animationTime;
    this.renderAccumulatorMs += tickerDeltaMs;
    if (this.renderAccumulatorMs < targetFrameInterval) return;
    this.renderAccumulatorMs %= targetFrameInterval;
    const visualDeltaMs = this.lastDrawTimeMs === null
      ? targetFrameInterval
      : Math.min(100, Math.max(0, animationTime - this.lastDrawTimeMs));
    this.lastDrawTimeMs = animationTime;
    if (this.needsResize) {
      this.needsResize = false;
      this.resize();
    }
    const drawStartedAt = performance.now();
    const playing = this.options.isPlaying();
    const director = playing
      ? sampleVisualDirector(this.cues, frame.timeMs, reducedMotion)
      : NEUTRAL_VISUAL_DIRECTOR_FRAME;
    const directorInfluence = intensity * (variant === 'immersive' ? 1 : 0.48);
    this.easeEnergy(playing ? Math.max(0.025, frame.energy) : 0.018);
    this.easeBass(playing ? frame.bass : 0.04);
    this.easeMid(playing ? frame.mid : 0.04);
    this.easeTreble(playing ? frame.treble : 0.04);
    if (playing && frame.onset) {
      this.visual.onset = Math.max(
        this.visual.onset,
        frame.onsetStrength * dna.burstPower
          * (this.hasDirectedBeatTimeline ? 0.5 : 1)
          * (reducedMotion ? 0.12 : intensity),
      );
    }
    if (playing
      && !this.hasDirectedBeatTimeline
      && crossedBeat(timeline?.beatsMs ?? [], this.lastPlaybackTimeMs, frame.timeMs)) {
      this.visual.onset = Math.max(
        this.visual.onset,
        (0.5 + dna.axes.pulse * 0.5) * (reducedMotion ? 0.08 : intensity),
      );
    }
    this.lastPlaybackTimeMs = frame.timeMs;
    this.visual.onset *= Math.exp(-visualDeltaMs / 190);
    const burstDrive = Math.max(this.visual.onset, director.burst * directorInfluence);
    const directedGlow = director.glow * (variant === 'immersive' ? 1 : 0.48);

    const context = this.context;
    const width = this.width;
    const height = this.height;
    context.clearRect(0, 0, width, height);
    const centerX = width * 0.5;
    const centerY = height * (variant === 'immersive' ? 0.48 : 0.51);
    const minSize = Math.min(width, height);
    const section = currentVisualSection(timeline?.sections ?? [], frame.timeMs);
    const sectionDrive = section?.axes.drive ?? dna.axes.drive;
    const sectionPulse = section?.axes.pulse ?? dna.axes.pulse;
    const sectionSpace = section?.axes.space ?? dna.axes.space;
    const artworkAvailable = Boolean(this.options.artworkField?.count);
    const artworkTarget = artworkMorphTarget({
      available: artworkAvailable,
      playing,
      reducedMotion,
      sectionDrive,
      sectionSpace,
      burstDrive,
    });
    this.easeArtwork(artworkTarget);
    const artworkMorph = this.visual.artwork * (variant === 'immersive' ? 1 : 0.72);
    const geometryScale = visualGeometryScale(
      variant,
      minSize,
      this.visual.bass,
      this.visual.energy,
      sectionSpace - dna.axes.space,
    );
    const motion = animationTime * 0.00018 * dna.rotationDirection
      * (0.55 + sectionPulse * 0.7) * (reducedMotion ? 0.18 : intensity);
    const palette = this.paletteTransition;
    const paletteProgress = transitionProgress(palette, animationTime);

    const availableGlowCount = palette.to.glowColors.length;
    const glowLayerCount = variant === 'compact'
      ? availableGlowCount
      : this.adaptiveQuality.scale < 0.8 || quality === 'eco'
        ? Math.min(2, availableGlowCount)
        : Math.min(quality === 'high' ? 4 : 3, availableGlowCount);
    for (let glowLayer = 0; glowLayer < glowLayerCount; glowLayer += 1) {
      const index = Math.floor((glowLayer / glowLayerCount) * availableGlowCount);
      const angle = (index / palette.to.glowColors.length) * Math.PI * 2 + motion * 0.24;
      const glowX = centerX
        + Math.cos(angle) * minSize * 0.08
        + director.offsetX * minSize * directorInfluence * 0.65;
      const glowY = centerY
        + Math.sin(angle) * minSize * 0.055
        + director.offsetY * minSize * directorInfluence * 0.65;
      const glow = context.createRadialGradient(
        glowX,
        glowY,
        0,
        centerX,
        centerY,
        minSize * ((variant === 'immersive' ? 0.64 : 0.48) + sectionSpace * 0.16),
      );
      const fromColor = palette.from.glowColors[index] ?? palette.to.glowColors[index];
      const toColor = palette.to.glowColors[index];
      const strength = ((index === 0
        ? variant === 'immersive' ? 0.16 : 0.105
        : variant === 'immersive' ? 0.06 : 0.038)
        + this.visual.energy * (0.03 + sectionDrive * 0.025)
        + burstDrive * 0.035
        + directedGlow * (index === 0 ? 0.085 : 0.035)) * intensity;
      glow.addColorStop(0, rgbaBetween(fromColor, toColor, paletteProgress, strength));
      glow.addColorStop(0.45, rgbaBetween(fromColor, toColor, paletteProgress, strength * 0.42));
      glow.addColorStop(1, 'rgba(4, 8, 17, 0)');
      context.fillStyle = glow;
      context.fillRect(0, 0, width, height);
    }

    const cameraScale = Math.max(0.96, 1 + director.zoom * directorInfluence);
    context.save();
    context.translate(
      centerX + director.offsetX * minSize * directorInfluence,
      centerY + director.offsetY * minSize * directorInfluence,
    );
    context.rotate(director.rotation * directorInfluence);
    context.scale(cameraScale, cameraScale);
    context.translate(-centerX, -centerY);

    const bars = palette.to.barColors.length;
    const barStep = this.adaptiveQuality.scale < 0.72 || quality === 'eco' ? 2 : 1;
    context.lineCap = 'round';
    context.globalCompositeOperation = variant === 'immersive' ? 'lighter' : 'source-over';
    for (let index = 0; index < bars; index += barStep) {
      const progress = index / bars;
      const point = sampleVisualDNA(dna, progress, motion);
      const previous = sampleVisualDNA(dna, progress - 0.0025, motion);
      const next = sampleVisualDNA(dna, progress + 0.0025, motion);
      const tangentX = next.x - previous.x;
      const tangentY = next.y - previous.y;
      const tangentLength = Math.hypot(tangentX, tangentY) || 1;
      let normalX = -tangentY / tangentLength;
      let normalY = tangentX / tangentLength;
      if (normalX * point.x + normalY * point.y < 0) {
        normalX *= -1;
        normalY *= -1;
      }
      const bandIndex = Math.floor((index / bars) * frame.bands.length);
      const value = Math.min(1, (frame.bands[bandIndex] ?? 0) * 9 + this.visual.energy * 0.16);
      const length = minSize * (
        (variant === 'immersive' ? 0.014 : 0.006)
        + value * (variant === 'immersive' ? 0.14 : 0.075)
      ) + burstDrive * minSize * 0.035;
      const x1 = centerX + point.x * geometryScale;
      const y1 = centerY + point.y * geometryScale;
      const colorIndex = (index + Math.floor(dna.paletteRotation * bars)) % bars;
      const fromColor = palette.from.barColors[colorIndex] ?? palette.to.barColors[colorIndex];
      const toColor = palette.to.barColors[colorIndex];
      context.strokeStyle = rgbaBetween(
        fromColor,
        toColor,
        paletteProgress,
        (variant === 'immersive' ? 0.32 + value * 0.78 : 0.18 + value * 0.72) * intensity,
      );
      context.lineWidth = Math.max(0.75, minSize * (variant === 'immersive' ? 0.00235 : 0.0027));
      context.beginPath();
      context.moveTo(x1, y1);
      context.lineTo(x1 + normalX * length, y1 + normalY * length);
      context.stroke();
    }

    context.globalCompositeOperation = 'lighter';
    const artworkField = this.options.artworkField;
    const artworkScale = minSize
      * (variant === 'immersive' ? 0.42 : 0.28)
      * (1 + this.visual.bass * 0.018);
    const particleCount = Math.max(12, Math.floor(
      this.particles.count * this.adaptiveQuality.scale * (reducedMotion ? 0.48 : 1),
    ));
    for (let index = 0; index < particleCount; index += 1) {
      const bandValue = Math.min(1, (frame.bands[this.particles.band[index]] ?? 0) * 8);
      const phase = (this.particles.phase[index]
        + this.particles.speed[index] * visualDeltaMs * (0.65 + dna.axes.pulse + bandValue * 0.8)
        + 1) % 1;
      this.particles.phase[index] = phase;
      const point = sampleVisualDNA(dna, phase, motion);
      const drift = Math.sin(
        this.particles.driftPhase[index]
          + animationTime * (0.00035 + dna.turbulence * 0.0011)
          + phase * Math.PI * 2 * dna.symmetry,
      ) * this.particles.drift[index] * minSize * (0.4 + dna.turbulence);
      const burstDistance = reducedMotion ? 0 : burstDrive * minSize * (0.025 + dna.burstPower * 0.075);
      const curveX = point.x * geometryScale * this.particles.layerScale[index];
      const curveY = point.y * geometryScale * this.particles.layerScale[index];
      const coverage = mixParticleCoverage(
        curveX,
        curveY,
        this.particles.fieldX[index],
        this.particles.fieldY[index],
        this.particles.fieldMix[index],
        width,
        height,
      );
      const artworkIndex = artworkField?.count
        ? this.particles.artworkIndex[index] % artworkField.count
        : 0;
      const artworkStrength = artworkField?.count
        ? artworkField.strength[artworkIndex]
        : 0;
      const artworkAmount = artworkField?.count
        ? Math.min(0.94, artworkMorph
          * this.particles.artworkAffinity[index]
          * (0.88 + artworkStrength * 0.12)
          * (1 - Math.min(0.62, burstDrive * 0.52)))
        : 0;
      const artworkX = artworkField?.count
        ? artworkField.x[artworkIndex] * artworkScale
        : coverage.x;
      const artworkY = artworkField?.count
        ? artworkField.y[artworkIndex] * artworkScale
        : coverage.y;
      const baseX = coverage.x + (artworkX - coverage.x) * artworkAmount;
      const baseY = coverage.y + (artworkY - coverage.y) * artworkAmount;
      const baseLength = Math.hypot(baseX, baseY) || 1;
      const burstRadialX = baseX / baseLength;
      const burstRadialY = baseY / baseLength;
      const remainingDrift = drift * (1 - artworkAmount * 0.86);
      const x = centerX + baseX + burstRadialX * burstDistance + burstRadialY * remainingDrift;
      const y = centerY + baseY + burstRadialY * burstDistance - burstRadialX * remainingDrift;
      const colorIndex = Math.floor(((phase + dna.paletteRotation) % 1) * palette.to.barColors.length);
      const fromColor = palette.from.barColors[colorIndex] ?? palette.to.barColors[colorIndex];
      const toColor = palette.to.barColors[colorIndex];
      const alpha = this.particles.alpha[index] * (
        (variant === 'immersive' ? 0.38 : 0.18)
        + this.visual.energy * (variant === 'immersive' ? 0.72 : 0.55)
        + bandValue * (variant === 'immersive' ? 0.64 : 0.45)
        + this.visual.treble * (variant === 'immersive' ? 0.28 : 0.18)
      ) * intensity * (1 + artworkAmount * (artworkStrength * 0.32 - 0.08));
      const artworkColorIndex = artworkIndex * 3;
      const artworkRed = artworkField?.count ? artworkField.colors[artworkColorIndex] : 0;
      const artworkGreen = artworkField?.count ? artworkField.colors[artworkColorIndex + 1] : 0;
      const artworkBlue = artworkField?.count ? artworkField.colors[artworkColorIndex + 2] : 0;
      const artworkColorMix = artworkAmount * 0.76;
      const previousX = this.particles.previousX[index];
      const previousY = this.particles.previousY[index];
      if (!reducedMotion
        && this.adaptiveQuality.scale > 0.68
        && quality !== 'eco'
        && dna.trail > 0.18
        && Number.isFinite(previousX)
        && Math.hypot(x - previousX, y - previousY) < minSize * 0.15) {
        context.strokeStyle = rgbaBetween(
          fromColor,
          toColor,
          paletteProgress,
          alpha * dna.trail * 0.38,
          artworkRed,
          artworkGreen,
          artworkBlue,
          artworkColorMix,
        );
        context.lineWidth = Math.max(0.55, this.particles.size[index] * 0.6);
        context.beginPath();
        context.moveTo(previousX, previousY);
        context.lineTo(x, y);
        context.stroke();
      }
      context.fillStyle = rgbaBetween(
        fromColor,
        toColor,
        paletteProgress,
        alpha,
        artworkRed,
        artworkGreen,
        artworkBlue,
        artworkColorMix,
      );
      const size = this.particles.size[index] * (1 + bandValue * 0.65 + burstDrive * 0.45)
        * (variant === 'immersive' ? 1.18 : 1)
        * (1 - artworkAmount * 0.16)
        * (width / Math.max(this.options.canvas.clientWidth, 1));
      context.beginPath();
      if (dna.primaryShape === 'burst') {
        context.moveTo(x + burstRadialX * size * 2.2, y + burstRadialY * size * 2.2);
        context.lineTo(x - burstRadialY * size, y + burstRadialX * size);
        context.lineTo(x - burstRadialX * size * 1.3, y - burstRadialY * size * 1.3);
        context.closePath();
      } else {
        context.arc(x, y, Math.max(0.45, size), 0, Math.PI * 2);
      }
      context.fill();
      this.particles.previousX[index] = x;
      this.particles.previousY[index] = y;
    }
    context.shadowBlur = 0;
    context.shadowColor = 'transparent';
    context.globalCompositeOperation = 'source-over';
    context.restore();
    this.updateAdaptiveQuality(
      performance.now() - drawStartedAt,
      visualDeltaMs,
      targetFrameInterval,
    );
  }

  private updateAdaptiveQuality(
    frameCost: number,
    frameIntervalMs: number,
    targetFrameIntervalMs: number,
  ): void {
    const budgetMs = this.options.quality === 'eco' ? 22 : 13.5;
    const previousScale = this.adaptiveQuality.scale;
    const nextScale = this.adaptiveQuality.record(
      frameCost,
      budgetMs,
      frameIntervalMs,
      targetFrameIntervalMs,
    );
    if (nextScale !== previousScale) this.needsResize = true;
  }
}
