import { useEffect, useMemo, useRef, useState } from 'react';
import {
  createFallbackProfile,
  createVisualDNA,
} from '../../shared/visual-analysis';
import { Icon } from '../components/Icon';
import { useAppStore, type VisualQuality } from '../store/useAppStore';
import {
  createVisualizerPalette,
  DEFAULT_ARTWORK_PALETTE,
} from './artworkPalette';
import { CanvasVisualRenderer } from './CanvasVisualRenderer';
import { useArtworkPalette } from './useArtworkPalette';
import { useArtworkParticleField } from './useArtworkParticleField';
import { useTrackVisualAnalysis } from './useTrackVisualAnalysis';

interface AudioVisualizerProps {
  active?: boolean;
  variant?: 'compact' | 'immersive';
  onEnterImmersive?: () => void;
}

const QUALITY_LABEL: Record<VisualQuality, string> = {
  eco: '节能',
  balanced: '平衡',
  high: '高质量',
};

export function AudioVisualizer({
  active = true,
  variant = 'compact',
  onEnterImmersive,
}: AudioVisualizerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<CanvasVisualRenderer | null>(null);
  const enabled = useAppStore((state) => state.visualsEnabled);
  const isPlaying = useAppStore((state) => state.isPlaying);
  const tracks = useAppStore((state) => state.tracks);
  const currentTrackId = useAppStore((state) => state.currentTrackId);
  const visualQuality = useAppStore((state) => state.visualQuality);
  const visualIntensity = useAppStore((state) => state.visualIntensity);
  const visualReducedMotion = useAppStore((state) => state.visualReducedMotion);
  const toggleVisuals = useAppStore((state) => state.toggleVisuals);
  const setVisualQuality = useAppStore((state) => state.setVisualQuality);
  const setVisualIntensity = useAppStore((state) => state.setVisualIntensity);
  const setVisualReducedMotion = useAppStore((state) => state.setVisualReducedMotion);
  const track = useMemo(
    () => tracks.find((item) => item.id === currentTrackId),
    [currentTrackId, tracks],
  );
  const artworkSource = track?.artworkUrl
    ? `${track.artworkUrl}?v=${Math.round(track.modifiedAt)}`
    : undefined;
  const artworkPalette = useArtworkPalette(artworkSource);
  const artworkField = useArtworkParticleField(artworkSource);
  const palette = useMemo(() => createVisualizerPalette(artworkPalette), [artworkPalette]);
  const trackAnalysis = useTrackVisualAnalysis(currentTrackId);
  const visualDNA = useMemo(
    () => trackAnalysis?.visualDNA
      ?? createVisualDNA(createFallbackProfile(), currentTrackId ?? 'lyralume-idle'),
    [currentTrackId, trackAnalysis?.visualDNA],
  );
  const isPlayingRef = useRef(isPlaying);
  const paletteRef = useRef(createVisualizerPalette(DEFAULT_ARTWORK_PALETTE));
  const [failed, setFailed] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [reanalyzing, setReanalyzing] = useState(false);
  const [analysisActionError, setAnalysisActionError] = useState<string>();

  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);

  useEffect(() => {
    setFailed(false);
  }, [currentTrackId, enabled, visualQuality, visualReducedMotion]);

  useEffect(() => {
    paletteRef.current = palette;
    rendererRef.current?.setPalette(palette);
  }, [palette]);

  useEffect(() => {
    if (!active || !enabled || failed || !canvasRef.current) return;
    try {
      const renderer = new CanvasVisualRenderer({
        canvas: canvasRef.current,
        variant,
        dna: visualDNA,
        timeline: trackAnalysis?.timeline,
        artworkField: artworkField ?? undefined,
        palette: paletteRef.current,
        quality: visualQuality,
        intensity: visualIntensity,
        reducedMotion: visualReducedMotion,
        isPlaying: () => isPlayingRef.current,
        onFailure: () => setFailed(true),
      });
      rendererRef.current = renderer;
      renderer.start();
      return () => {
        renderer.stop();
        if (rendererRef.current === renderer) rendererRef.current = null;
      };
    } catch {
      setFailed(true);
    }
  }, [
    active,
    artworkField,
    enabled,
    failed,
    trackAnalysis?.timeline,
    variant,
    visualDNA,
    visualIntensity,
    visualQuality,
    visualReducedMotion,
  ]);

  const runAnalysis = async (): Promise<void> => {
    if (!currentTrackId || reanalyzing) return;
    setReanalyzing(true);
    setAnalysisActionError(undefined);
    try {
      await window.lyralume.visuals.reanalyze(currentTrackId);
    } catch (error) {
      setAnalysisActionError(error instanceof Error ? error.message : '无法启动歌曲分析');
    } finally {
      setReanalyzing(false);
    }
  };

  const analysisLabel = analysisActionError ?? (trackAnalysis?.status === 'ready'
    ? `已分析 · ${trackAnalysis.profile?.bpm ? `${Math.round(trackAnalysis.profile.bpm)} BPM` : '自由节奏'}${
      trackAnalysis.profile?.key
        ? ` · ${trackAnalysis.profile.key} ${trackAnalysis.profile.mode === 'major' ? '大调' : '小调'}`
        : ''
    }`
    : trackAnalysis?.status === 'running'
      ? `分析中 ${Math.round(trackAnalysis.progress * 100)}%`
      : trackAnalysis?.status === 'failed'
        ? '整曲分析失败，已使用实时模式'
        : '等待整曲分析');

  return (
    <div
      className={`visualizer visualizer--${variant}`}
      data-enabled={active && enabled && !failed}
      data-visual-shape={visualDNA.primaryShape}
    >
      <canvas ref={canvasRef} aria-hidden="true" />
      {(!enabled || failed) && (
        <div className="visualizer__off">
          <Icon name="sparkles" />
          <span>{failed ? '视觉模块已安全停用' : '视觉效果已关闭'}</span>
        </div>
      )}
      {variant === 'compact' && (
        <div className="visualizer__actions">
          {onEnterImmersive && (
            <button
              className="visualizer__immersive"
              type="button"
              onClick={onEnterImmersive}
              disabled={!currentTrackId || !enabled}
              title={!currentTrackId ? '播放歌曲后进入沉浸视觉' : !enabled ? '请先开启视觉效果' : '进入沉浸视觉'}
              aria-label="进入沉浸视觉"
            >
              <Icon name="fullscreen" />
              沉浸视觉
            </button>
          )}
          <button
            className="visualizer__settings-toggle"
            type="button"
            onClick={() => setSettingsOpen((open) => !open)}
            aria-expanded={settingsOpen}
            aria-controls="visualizer-settings"
          >
            <Icon name="sparkles" />
            视觉设置
          </button>
          <button className="visualizer__toggle" type="button" onClick={toggleVisuals} aria-pressed={enabled}>
            <Icon name="sparkles" />
            {enabled ? '关闭视觉' : '开启视觉'}
          </button>
        </div>
      )}
      {variant === 'compact' && settingsOpen && (
        <section className="visualizer-settings" id="visualizer-settings" aria-label="视觉设置">
          <header>
            <strong>视觉响应</strong>
            <span>{analysisLabel}</span>
          </header>
          <label>
            <span>质量</span>
            <select
              value={visualQuality}
              onChange={(event) => setVisualQuality(event.target.value as VisualQuality)}
            >
              {(Object.keys(QUALITY_LABEL) as VisualQuality[]).map((quality) => (
                <option key={quality} value={quality}>{QUALITY_LABEL[quality]}</option>
              ))}
            </select>
          </label>
          <label>
            <span>强度</span>
            <input
              type="range"
              min="0.35"
              max="1.35"
              step="0.05"
              value={visualIntensity}
              onChange={(event) => setVisualIntensity(Number(event.target.value))}
              style={{ '--range-progress': `${((visualIntensity - 0.35) / 1) * 100}%` } as React.CSSProperties}
            />
          </label>
          <label className="visualizer-settings__check">
            <input
              type="checkbox"
              checked={visualReducedMotion}
              onChange={(event) => setVisualReducedMotion(event.target.checked)}
            />
            <span>减少动态</span>
          </label>
          <button
            type="button"
            onClick={() => void runAnalysis()}
            disabled={!currentTrackId || reanalyzing || trackAnalysis?.status === 'running'}
          >
            <Icon name="refresh" />
            {trackAnalysis?.status === 'running'
              ? '正在分析当前歌曲'
              : reanalyzing ? '已加入分析队列' : '重新分析当前歌曲'}
          </button>
        </section>
      )}
    </div>
  );
}
