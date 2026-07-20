import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { audioEngine } from '../audio/AudioEngine';
import { seekPlayback } from '../audio/seekPlayback';
import { Artwork } from '../components/Artwork';
import { Icon } from '../components/Icon';
import { PlaybackTimeline } from '../components/PlaybackTimeline';
import { currentTrackFromState, useAppStore } from '../store/useAppStore';
import {
  createImmersiveTheme,
  type RgbColor,
} from '../visuals/artworkPalette';
import { AudioVisualizer } from '../visuals/AudioVisualizer';
import { useArtworkPalette } from '../visuals/useArtworkPalette';
import { ImmersiveLyrics } from './ImmersiveLyrics';

const CONTROLS_HIDE_DELAY_MS = 2_600;

type ImmersiveStyle = CSSProperties & Record<`--${string}`, string | number>;

function rgb(color: RgbColor): string {
  return `rgb(${color[0]} ${color[1]} ${color[2]})`;
}

export function ImmersivePlayer({
  active,
  onExit,
}: {
  active: boolean;
  onExit(): void;
}) {
  const sectionRef = useRef<HTMLElement>(null);
  const hideTimerRef = useRef<number | null>(null);
  const [controlsVisible, setControlsVisible] = useState(true);
  const track = useAppStore(currentTrackFromState);
  const isPlaying = useAppStore((state) => state.isPlaying);
  const currentTime = useAppStore((state) => state.currentTime);
  const duration = useAppStore((state) => state.duration);
  const volume = useAppStore((state) => state.volume);
  const togglePlayback = useAppStore((state) => state.togglePlayback);
  const previousTrack = useAppStore((state) => state.previousTrack);
  const nextTrack = useAppStore((state) => state.nextTrack);
  const setVolume = useAppStore((state) => state.setVolume);
  const visualOnly = track?.language === 'zxx';
  const artworkSource = useMemo(() => (
    track?.artworkUrl ? `${track.artworkUrl}?v=${Math.round(track.modifiedAt)}` : undefined
  ), [track]);
  const artworkPalette = useArtworkPalette(artworkSource);
  const theme = useMemo(() => createImmersiveTheme(artworkPalette), [artworkPalette]);
  const safeDuration = Math.max(duration || track?.duration || 0, 0);
  const style: ImmersiveStyle = {
    '--immersive-background': rgb(theme.background),
    '--immersive-background-alt': rgb(theme.backgroundAlt),
    '--immersive-accent': rgb(theme.accent),
    '--immersive-accent-secondary': rgb(theme.accentSecondary),
    '--immersive-active-text': rgb(theme.activeText),
    '--immersive-translation-text': rgb(theme.translationText),
    '--immersive-muted-text': rgb(theme.mutedText),
  };

  const clearHideTimer = useCallback((): void => {
    if (hideTimerRef.current !== null) window.clearTimeout(hideTimerRef.current);
    hideTimerRef.current = null;
  }, []);

  const revealControls = useCallback((): void => {
    clearHideTimer();
    setControlsVisible(true);
    if (isPlaying) {
      hideTimerRef.current = window.setTimeout(() => {
        const focused = document.activeElement;
        if (
          focused instanceof HTMLElement
          && focused !== sectionRef.current
          && sectionRef.current?.contains(focused)
        ) {
          hideTimerRef.current = null;
          return;
        }
        setControlsVisible(false);
        hideTimerRef.current = null;
      }, CONTROLS_HIDE_DELAY_MS);
    }
  }, [clearHideTimer, isPlaying]);

  useEffect(() => {
    if (!active) {
      clearHideTimer();
      return;
    }
    revealControls();
    return clearHideTimer;
  }, [active, clearHideTimer, revealControls]);

  useEffect(() => {
    if (!active) return;
    const frame = window.requestAnimationFrame(() => {
      sectionRef.current?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [active]);

  useEffect(() => {
    if (!active) return;
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onExit();
        return;
      }
      const target = event.target;
      if (target instanceof HTMLElement && target.closest('button, input, textarea, [contenteditable="true"]')) {
        return;
      }
      if (event.code === 'Space') {
        event.preventDefault();
        togglePlayback();
        revealControls();
      } else if (event.code === 'ArrowLeft') {
        event.preventDefault();
        seekPlayback(audioEngine.getPlaybackSnapshot().currentTime - 5);
        revealControls();
      } else if (event.code === 'ArrowRight') {
        event.preventDefault();
        seekPlayback(audioEngine.getPlaybackSnapshot().currentTime + 5);
        revealControls();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [active, onExit, revealControls, togglePlayback]);

  if (!active) return null;

  return (
    <section
      ref={sectionRef}
      className="immersive-player"
      data-controls-visible={controlsVisible || !isPlaying}
      style={style}
      tabIndex={-1}
      aria-label="沉浸视觉播放器"
      onPointerMove={revealControls}
      onPointerDown={(event) => {
        const target = event.target;
        if (!(target instanceof HTMLElement) || !target.closest('button, input')) {
          sectionRef.current?.focus({ preventScroll: true });
        }
        revealControls();
      }}
      onFocusCapture={revealControls}
    >
      <div className="immersive-player__ambient" aria-hidden="true" />
      {artworkSource && (
        <div
          className="immersive-player__artwork-wash"
          style={{ backgroundImage: `url(${JSON.stringify(artworkSource)})` }}
          aria-hidden="true"
        />
      )}

      <header className="immersive-player__topbar">
        <button type="button" onClick={onExit} aria-label="退出沉浸视觉">
          <Icon name="fullscreenExit" />
          <span>Esc 退出</span>
        </button>
      </header>

      <div className="immersive-player__layout" data-visual-only={visualOnly}>
        <div className="immersive-player__visual-stage">
          <AudioVisualizer active={active} variant="immersive" />
          <div className="immersive-player__visual-core">
            <Artwork track={track} className="immersive-player__hero-artwork" />
            <span>NOW PLAYING</span>
            <strong>{track?.title ?? '等待播放'}</strong>
            <small>{track?.artist ?? '从音乐库选择一首歌曲'}</small>
          </div>
        </div>
        {!visualOnly && <ImmersiveLyrics />}
      </div>

      <footer className="immersive-player__controls">
        <div className="immersive-player__transport">
          <button type="button" onClick={previousTrack} disabled={!track} aria-label="上一首">
            <Icon name="back" />
          </button>
          <button
            className="immersive-player__play"
            type="button"
            onClick={togglePlayback}
            disabled={!track}
            aria-label={isPlaying ? '暂停' : '播放'}
          >
            <Icon name={isPlaying ? 'pause' : 'play'} />
          </button>
          <button type="button" onClick={nextTrack} disabled={!track} aria-label="下一首">
            <Icon name="forward" />
          </button>
        </div>
        <PlaybackTimeline
          className="immersive-player__timeline"
          trackId={track?.id ?? null}
          currentTime={currentTime}
          duration={safeDuration}
        />
        <label className="immersive-player__volume">
          <Icon name="volume" />
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={volume}
            onChange={(event) => setVolume(Number(event.target.value))}
            style={{ '--range-progress': `${volume * 100}%` } as CSSProperties}
            aria-label="音量"
          />
        </label>
      </footer>
    </section>
  );
}
