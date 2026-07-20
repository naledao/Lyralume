import { useEffect, useRef, useState, type RefObject } from 'react';
import { useAppStore, type VisualQuality } from '../store/useAppStore';
import { audioAnalysisHub } from '../visuals/audioAnalysisHub';
import {
  advanceLyricParticles,
  createLyricBurstParticle,
  createLyricProgressParticle,
  getLyricBurstParticleCount,
  getLyricParticleOpacity,
  getLyricProgressEmissionRate,
  type LyricParticle,
  type LyricParticleBounds,
} from './lyricParticles';

const CANVAS_PIXEL_BUDGET: Record<VisualQuality, number> = {
  eco: 420_000,
  balanced: 700_000,
  high: 950_000,
};
const PARTICLE_LIMIT: Record<VisualQuality, number> = {
  eco: 24,
  balanced: 48,
  high: 64,
};
const GEOMETRY_INTERVAL_MS = 64;
const COLOR_INTERVAL_MS = 1_000;
const BURST_COOLDOWN_MS = 360;

function clearCanvas(canvas: HTMLCanvasElement, context: CanvasRenderingContext2D): void {
  context.save();
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.restore();
}

function readParticleBounds(
  canvas: HTMLCanvasElement,
  activeText: HTMLElement,
): LyricParticleBounds | null {
  const canvasBounds = canvas.getBoundingClientRect();
  const textBounds = activeText.getBoundingClientRect();
  if (textBounds.width <= 0 || textBounds.height <= 0) return null;
  return {
    left: textBounds.left - canvasBounds.left,
    top: textBounds.top - canvasBounds.top,
    width: textBounds.width,
    height: textBounds.height,
  };
}

function useReducedMotion(): boolean {
  const [reducedMotion, setReducedMotion] = useState(() => (
    typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
      : false
  ));

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = (): void => setReducedMotion(query.matches);
    query.addEventListener('change', update);
    update();
    return () => query.removeEventListener('change', update);
  }, []);

  return reducedMotion;
}

export function LyricParticleLayer({
  activeIndex,
  cueProgressRef,
  scrollerRef,
}: {
  activeIndex: number;
  cueProgressRef: RefObject<number>;
  scrollerRef: RefObject<HTMLDivElement | null>;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const contextRef = useRef<CanvasRenderingContext2D | null>(null);
  const activeTextRef = useRef<HTMLElement | null>(null);
  const activeBoundsRef = useRef<LyricParticleBounds | null>(null);
  const particlesRef = useRef<LyricParticle[]>([]);
  const pendingBurstRef = useRef(false);
  const emissionAccumulatorRef = useRef(0);
  const lastGeometryReadRef = useRef(Number.NEGATIVE_INFINITY);
  const lastColorReadRef = useRef(Number.NEGATIVE_INFINITY);
  const lastBurstRef = useRef(Number.NEGATIVE_INFINITY);
  const lastTickerTimeRef = useRef<number | null>(null);
  const lastDrawTimeRef = useRef<number | null>(null);
  const renderAccumulatorRef = useRef(0);
  const colorsRef = useRef<[string, string]>(['rgb(157 139 255)', 'rgb(87 231 213)']);
  const visualsEnabled = useAppStore((state) => state.visualsEnabled);
  const visualQuality = useAppStore((state) => state.visualQuality);
  const visualReducedMotion = useAppStore((state) => state.visualReducedMotion);
  const reducedMotion = useReducedMotion() || visualReducedMotion;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext('2d');
    if (!context) return;
    contextRef.current = context;

    const resize = (): void => {
      const bounds = canvas.getBoundingClientRect();
      const cssPixels = Math.max(1, bounds.width * bounds.height);
      const scale = Math.max(0.5, Math.min(
        window.devicePixelRatio || 1,
        1.25,
        Math.sqrt(CANVAS_PIXEL_BUDGET[visualQuality] / cssPixels),
      ));
      canvas.width = Math.max(1, Math.round(bounds.width * scale));
      canvas.height = Math.max(1, Math.round(bounds.height * scale));
      context.setTransform(scale, 0, 0, scale, 0, 0);
      activeBoundsRef.current = null;
    };

    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(resize) : null;
    observer?.observe(canvas);
    window.addEventListener('resize', resize);
    resize();
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', resize);
      clearCanvas(canvas, context);
      contextRef.current = null;
    };
  }, [visualQuality]);

  useEffect(() => {
    activeTextRef.current = null;
    activeBoundsRef.current = null;
    emissionAccumulatorRef.current = 0;
    pendingBurstRef.current = activeIndex >= 0;
    if (activeIndex < 0) return;
    const frame = window.requestAnimationFrame(() => {
      activeTextRef.current = scrollerRef.current?.querySelector<HTMLElement>(
        '[data-active="true"] [data-role="original"]',
      ) ?? null;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [activeIndex, scrollerRef]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = contextRef.current;
    if (!canvas || !context || activeIndex < 0 || !visualsEnabled || reducedMotion) {
      particlesRef.current.length = 0;
      if (canvas && context) clearCanvas(canvas, context);
      return;
    }
    lastTickerTimeRef.current = null;
    lastDrawTimeRef.current = null;
    renderAccumulatorRef.current = 0;

    const unsubscribe = audioAnalysisHub.subscribe((audioFrame) => {
      const targetFrameInterval = visualQuality === 'eco' ? 1_000 / 30 : 1_000 / 60;
      const tickerDeltaMs = lastTickerTimeRef.current === null
        ? targetFrameInterval
        : Math.min(100, Math.max(0, audioFrame.animationTimeMs - lastTickerTimeRef.current));
      lastTickerTimeRef.current = audioFrame.animationTimeMs;
      renderAccumulatorRef.current += tickerDeltaMs;
      if (renderAccumulatorRef.current < targetFrameInterval) return;
      renderAccumulatorRef.current %= targetFrameInterval;
      const visualDeltaMs = lastDrawTimeRef.current === null
        ? targetFrameInterval
        : Math.min(100, Math.max(0, audioFrame.animationTimeMs - lastDrawTimeRef.current));
      lastDrawTimeRef.current = audioFrame.animationTimeMs;
      clearCanvas(canvas, context);
      const activeText = activeTextRef.current;
      if (!activeText || document.visibilityState === 'hidden') return;

      if (audioFrame.timeMs - lastGeometryReadRef.current >= GEOMETRY_INTERVAL_MS) {
        activeBoundsRef.current = readParticleBounds(canvas, activeText);
        lastGeometryReadRef.current = audioFrame.timeMs;
      }
      if (audioFrame.timeMs - lastColorReadRef.current >= COLOR_INTERVAL_MS) {
        const styles = getComputedStyle(canvas);
        colorsRef.current = [
          styles.getPropertyValue('--immersive-accent').trim() || colorsRef.current[0],
          styles.getPropertyValue('--immersive-accent-secondary').trim() || colorsRef.current[1],
        ];
        lastColorReadRef.current = audioFrame.timeMs;
      }

      const bounds = activeBoundsRef.current;
      if (!bounds) return;
      const particles = particlesRef.current;
      if (
        pendingBurstRef.current
        && audioFrame.timeMs - lastBurstRef.current >= BURST_COOLDOWN_MS
      ) {
        const burstCount = getLyricBurstParticleCount(audioFrame.energy);
        for (
          let index = 0;
          index < burstCount && particles.length < PARTICLE_LIMIT[visualQuality];
          index += 1
        ) {
          particles.push(createLyricBurstParticle(bounds, audioFrame.energy));
        }
        pendingBurstRef.current = false;
        lastBurstRef.current = audioFrame.timeMs;
      }

      emissionAccumulatorRef.current = Math.min(
        2,
        emissionAccumulatorRef.current + getLyricProgressEmissionRate(
          audioFrame.energy,
          audioFrame.treble,
        ) * visualDeltaMs / 1_000,
      );
      while (
        emissionAccumulatorRef.current >= 1
        && particles.length < PARTICLE_LIMIT[visualQuality]
      ) {
        particles.push(createLyricProgressParticle(
          bounds,
          cueProgressRef.current,
          audioFrame.energy,
        ));
        emissionAccumulatorRef.current -= 1;
      }

      advanceLyricParticles(particles, visualDeltaMs);
      context.globalCompositeOperation = 'source-over';
      for (const particle of particles) {
        const opacity = getLyricParticleOpacity(particle);
        if (opacity <= 0.002) continue;
        const color = colorsRef.current[particle.colorIndex];
        context.globalAlpha = opacity;
        context.fillStyle = color;
        context.beginPath();
        context.arc(particle.x, particle.y, particle.size, 0, Math.PI * 2);
        context.fill();
      }
      context.globalAlpha = 1;
    });

    return unsubscribe;
  }, [activeIndex, cueProgressRef, reducedMotion, visualQuality, visualsEnabled]);

  return <canvas className="immersive-lyrics__particles" ref={canvasRef} aria-hidden="true" />;
}
