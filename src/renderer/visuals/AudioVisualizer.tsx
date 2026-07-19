import { gsap } from 'gsap';
import { useEffect, useMemo, useRef, useState } from 'react';
import { audioEngine } from '../audio/AudioEngine';
import { Icon } from '../components/Icon';
import { useAppStore } from '../store/useAppStore';
import {
  createVisualizerPalette,
  DEFAULT_ARTWORK_PALETTE,
  interpolateVisualizerPalette,
  type RgbColor,
  type VisualizerPalette,
} from './artworkPalette';
import { useArtworkPalette } from './useArtworkPalette';

interface Particle {
  angle: number;
  radius: number;
  size: number;
  speed: number;
  alpha: number;
}

interface PaletteTransition {
  from: VisualizerPalette;
  to: VisualizerPalette;
  startedAt: number;
}

const PALETTE_TRANSITION_MS = 560;
const DEFAULT_VISUALIZER_PALETTE = createVisualizerPalette(DEFAULT_ARTWORK_PALETTE);

function transitionProgress(transition: PaletteTransition, time: number): number {
  const linear = Math.min(1, Math.max(0, (time - transition.startedAt) / PALETTE_TRANSITION_MS));
  return 1 - (1 - linear) ** 3;
}

function rgbaBetween(
  from: RgbColor,
  to: RgbColor,
  progress: number,
  alpha: number,
): string {
  const red = Math.round(from[0] + (to[0] - from[0]) * progress);
  const green = Math.round(from[1] + (to[1] - from[1]) * progress);
  const blue = Math.round(from[2] + (to[2] - from[2]) * progress);
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

export function AudioVisualizer() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const enabled = useAppStore((state) => state.visualsEnabled);
  const isPlaying = useAppStore((state) => state.isPlaying);
  const tracks = useAppStore((state) => state.tracks);
  const currentTrackId = useAppStore((state) => state.currentTrackId);
  const artworkSource = useMemo(() => {
    const track = tracks.find((item) => item.id === currentTrackId);
    return track?.artworkUrl
      ? `${track.artworkUrl}?v=${Math.round(track.modifiedAt)}`
      : undefined;
  }, [currentTrackId, tracks]);
  const toggleVisuals = useAppStore((state) => state.toggleVisuals);
  const artworkPalette = useArtworkPalette(artworkSource);
  const isPlayingRef = useRef(isPlaying);
  const paletteTransitionRef = useRef<PaletteTransition>({
    from: DEFAULT_VISUALIZER_PALETTE,
    to: DEFAULT_VISUALIZER_PALETTE,
    startedAt: 0,
  });
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);

  useEffect(() => {
    const time = performance.now();
    const transition = paletteTransitionRef.current;
    const from = interpolateVisualizerPalette(
      transition.from,
      transition.to,
      transitionProgress(transition, time),
    );
    paletteTransitionRef.current = {
      from,
      to: createVisualizerPalette(artworkPalette),
      startedAt: time,
    };
  }, [artworkPalette]);

  useEffect(() => {
    if (!enabled || failed) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext('2d');
    if (!context) {
      setFailed(true);
      return;
    }

    const particles: Particle[] = Array.from({ length: 46 }, (_, index) => ({
      angle: (index / 46) * Math.PI * 2,
      radius: 0.25 + Math.random() * 0.5,
      size: 0.7 + Math.random() * 1.8,
      speed: 0.0006 + Math.random() * 0.0014,
      alpha: 0.18 + Math.random() * 0.55,
    }));
    const visual = { energy: 0.08 };
    const easeEnergy = gsap.quickTo(visual, 'energy', { duration: 0.2, ease: 'power2.out' });
    let frequencyData = new Uint8Array(256);
    let width = 0;
    let height = 0;
    let lastTime = performance.now();

    const resize = (): void => {
      const bounds = canvas.getBoundingClientRect();
      const scale = Math.min(window.devicePixelRatio || 1, 2);
      width = Math.max(1, Math.round(bounds.width * scale));
      height = Math.max(1, Math.round(bounds.height * scale));
      canvas.width = width;
      canvas.height = height;
    };
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    resize();

    const draw = (timeSeconds: number): void => {
      try {
        const time = timeSeconds * 1000;
        const delta = Math.min(40, time - lastTime);
        lastTime = time;
        const analyser = audioEngine.getAnalyser();
        if (analyser) {
          if (frequencyData.length !== analyser.frequencyBinCount) {
            frequencyData = new Uint8Array(analyser.frequencyBinCount);
          }
          analyser.getByteFrequencyData(frequencyData);
        } else {
          frequencyData.fill(0);
        }
        let sum = 0;
        const sampleCount = Math.min(90, frequencyData.length);
        for (let index = 0; index < sampleCount; index += 1) sum += frequencyData[index];
        const measured = sampleCount ? sum / sampleCount / 255 : 0;
        easeEnergy(isPlayingRef.current ? Math.max(0.045, measured) : 0.025);

        context.clearRect(0, 0, width, height);
        const centerX = width * 0.5;
        const centerY = height * 0.51;
        const minSize = Math.min(width, height);
        const paletteTransition = paletteTransitionRef.current;
        const paletteProgress = transitionProgress(paletteTransition, time);
        for (let index = 0; index < paletteTransition.to.glowColors.length; index += 1) {
          const angle = (index / paletteTransition.to.glowColors.length) * Math.PI * 2
            + time * 0.000025;
          const glowX = centerX + Math.cos(angle) * minSize * 0.075;
          const glowY = centerY + Math.sin(angle) * minSize * 0.055;
          const glow = context.createRadialGradient(
            glowX,
            glowY,
            0,
            centerX,
            centerY,
            minSize * 0.58,
          );
          const fromColor = paletteTransition.from.glowColors[index]
            ?? paletteTransition.to.glowColors[index];
          const toColor = paletteTransition.to.glowColors[index];
          const strength = (index === 0 ? 0.115 : 0.045) + visual.energy * 0.055;
          glow.addColorStop(0, rgbaBetween(fromColor, toColor, paletteProgress, strength));
          glow.addColorStop(0.42, rgbaBetween(
            fromColor,
            toColor,
            paletteProgress,
            strength * 0.48,
          ));
          glow.addColorStop(1, 'rgba(4, 8, 17, 0)');
          context.fillStyle = glow;
          context.fillRect(0, 0, width, height);
        }

        const bars = paletteTransition.to.barColors.length;
        const baseRadius = minSize * (0.16 + visual.energy * 0.045);
        context.lineCap = 'round';
        for (let index = 0; index < bars; index += 1) {
          const angle = (index / bars) * Math.PI * 2 - Math.PI / 2;
          const frequencyIndex = Math.floor((index / bars) * Math.min(110, frequencyData.length));
          const value = (frequencyData[frequencyIndex] ?? 0) / 255;
          const length = minSize * (0.014 + value * 0.11);
          const x1 = centerX + Math.cos(angle) * baseRadius;
          const y1 = centerY + Math.sin(angle) * baseRadius;
          const x2 = centerX + Math.cos(angle) * (baseRadius + length);
          const y2 = centerY + Math.sin(angle) * (baseRadius + length);
          const fromColor = paletteTransition.from.barColors[index]
            ?? paletteTransition.to.barColors[index];
          const toColor = paletteTransition.to.barColors[index];
          context.strokeStyle = rgbaBetween(
            fromColor,
            toColor,
            paletteProgress,
            0.3 + value * 0.7,
          );
          context.lineWidth = Math.max(1, minSize * 0.004);
          context.beginPath();
          context.moveTo(x1, y1);
          context.lineTo(x2, y2);
          context.stroke();
        }

        for (const particle of particles) {
          particle.angle += particle.speed * delta * (0.5 + visual.energy * 4);
          const radius = particle.radius * minSize * (0.42 + visual.energy * 0.2);
          const x = centerX + Math.cos(particle.angle) * radius;
          const y = centerY + Math.sin(particle.angle) * radius * 0.62;
          const normalizedAngle = ((particle.angle % (Math.PI * 2)) + Math.PI * 2)
            % (Math.PI * 2);
          const colorIndex = Math.floor(
            (normalizedAngle / (Math.PI * 2)) * paletteTransition.to.barColors.length,
          );
          const fromColor = paletteTransition.from.barColors[colorIndex]
            ?? paletteTransition.to.barColors[colorIndex];
          const toColor = paletteTransition.to.barColors[colorIndex];
          context.fillStyle = rgbaBetween(
            fromColor,
            toColor,
            paletteProgress,
            particle.alpha * (0.35 + visual.energy),
          );
          context.beginPath();
          context.arc(x, y, particle.size * (width / Math.max(canvas.clientWidth, 1)), 0, Math.PI * 2);
          context.fill();
        }
      } catch {
        gsap.ticker.remove(draw);
        setFailed(true);
      }
    };

    gsap.ticker.add(draw);
    return () => {
      gsap.ticker.remove(draw);
      observer.disconnect();
    };
  }, [enabled, failed]);

  return (
    <div className="visualizer" data-enabled={enabled && !failed}>
      <canvas ref={canvasRef} aria-hidden="true" />
      {(!enabled || failed) && (
        <div className="visualizer__off">
          <Icon name="sparkles" />
          <span>{failed ? '视觉模块已安全停用' : '视觉效果已关闭'}</span>
        </div>
      )}
      <button className="visualizer__toggle" type="button" onClick={toggleVisuals} aria-pressed={enabled}>
        <Icon name="sparkles" />
        {enabled ? '关闭视觉' : '开启视觉'}
      </button>
    </div>
  );
}
