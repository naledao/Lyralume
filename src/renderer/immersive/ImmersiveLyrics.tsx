import { gsap } from 'gsap';
import { useEffect, useMemo, useRef, useState } from 'react';
import { findActiveLyricIndex, groupLyricLines } from '../../shared/lrc';
import { audioEngine } from '../audio/AudioEngine';
import { seekPlayback } from '../audio/seekPlayback';
import { formatTime } from '../lib/format';
import { useAppStore } from '../store/useAppStore';
import { audioAnalysisHub } from '../visuals/audioAnalysisHub';
import { Icon } from '../components/Icon';
import { LyricParticleLayer } from './LyricParticleLayer';
import { lyricTokenProgressAtTime } from './lyricTokenProgress';

function clampUnit(value: number): number {
  return Math.min(1, Math.max(0, value));
}

export function ImmersiveLyrics() {
  const rootRef = useRef<HTMLDivElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const activeIndexRef = useRef(-1);
  const cueProgressRef = useRef(0);
  const activeTokenElementsRef = useRef<HTMLElement[]>([]);
  const activeTokenCueIndexRef = useRef(-1);
  const lastTickerTimeRef = useRef<number | null>(null);
  const updateAccumulatorRef = useRef(0);
  const lastAmbientUpdateRef = useRef(Number.NEGATIVE_INFINITY);
  const currentTrackId = useAppStore((state) => state.currentTrackId);
  const status = useAppStore((state) => state.lyricsStatus);
  const lines = useAppStore((state) => state.lyricLines);
  const offsetMs = useAppStore((state) => state.lyricOffsetMs);
  const error = useAppStore((state) => state.lyricsError);
  const duration = useAppStore((state) => state.duration);
  const cues = useMemo(() => groupLyricLines(lines), [lines]);
  const [activeIndex, setActiveIndex] = useState(-1);

  useEffect(() => {
    activeIndexRef.current = -1;
    activeTokenCueIndexRef.current = -2;
    activeTokenElementsRef.current = [];
    cueProgressRef.current = 0;
    lastTickerTimeRef.current = null;
    updateAccumulatorRef.current = 0;
    lastAmbientUpdateRef.current = Number.NEGATIVE_INFINITY;
    setActiveIndex(-1);
  }, [currentTrackId]);

  useEffect(() => {
    if (status !== 'loaded' || cues.length === 0) return;
    activeTokenCueIndexRef.current = -2;
    activeTokenElementsRef.current = [];
    const update = (energy: number, bass: number, animationTimeMs: number): void => {
      const root = rootRef.current;
      const snapshot = audioEngine.getPlaybackSnapshot();
      const fallbackTime = useAppStore.getState().currentTime;
      const playbackTime = snapshot.hasSource ? snapshot.currentTime : fallbackTime;
      const nextActiveIndex = findActiveLyricIndex(cues, playbackTime, offsetMs);
      if (nextActiveIndex !== activeIndexRef.current) {
        activeIndexRef.current = nextActiveIndex;
        setActiveIndex(nextActiveIndex);
      }
      const activeCue = cues[nextActiveIndex];
      const nextCue = cues[nextActiveIndex + 1];
      const adjustedTime = playbackTime - offsetMs / 1_000;
      const cueEnd = nextCue?.time ?? Math.max(activeCue?.time ?? 0, duration, adjustedTime + 4);
      const cueProgress = activeCue
        ? clampUnit((adjustedTime - activeCue.time) / Math.max(0.25, cueEnd - activeCue.time))
        : 0;
      cueProgressRef.current = cueProgress;
      if (activeTokenCueIndexRef.current !== nextActiveIndex) {
        activeTokenCueIndexRef.current = nextActiveIndex;
        const cueElement = scrollerRef.current?.querySelector<HTMLElement>(
          `[data-cue-index="${nextActiveIndex}"]`,
        );
        activeTokenElementsRef.current = cueElement
          ? [...cueElement.querySelectorAll<HTMLElement>('[data-lyric-token]')]
          : [];
      }
      const originalLine = activeCue?.lines.find((line) => line.role === 'original');
      if (originalLine?.tokens?.length === activeTokenElementsRef.current.length) {
        originalLine.tokens.forEach((token, index) => {
          const tokenElement = activeTokenElementsRef.current[index];
          const tokenProgress = lyricTokenProgressAtTime(token, adjustedTime);
          if (tokenProgress.state === 'current' || tokenElement.dataset.tokenState !== tokenProgress.state) {
            tokenElement.style.setProperty('--immersive-token-progress', `${tokenProgress.progress * 100}%`);
          }
          if (tokenElement.dataset.tokenState !== tokenProgress.state) {
            tokenElement.dataset.tokenState = tokenProgress.state;
          }
        });
      }
      root?.style.setProperty('--immersive-cue-progress', `${cueProgress * 100}%`);
      if (animationTimeMs - lastAmbientUpdateRef.current >= 1_000 / 30) {
        root?.style.setProperty('--immersive-energy-opacity', `${0.16 + energy * 0.32}`);
        root?.style.setProperty('--immersive-bass-scale', `${1 + bass * 0.012}`);
        lastAmbientUpdateRef.current = animationTimeMs;
      }
    };

    const unsubscribe = audioAnalysisHub.subscribe((frame) => {
      const targetFrameInterval = 1_000 / 60;
      const tickerDeltaMs = lastTickerTimeRef.current === null
        ? targetFrameInterval
        : Math.min(100, Math.max(0, frame.animationTimeMs - lastTickerTimeRef.current));
      lastTickerTimeRef.current = frame.animationTimeMs;
      updateAccumulatorRef.current += tickerDeltaMs;
      if (updateAccumulatorRef.current < targetFrameInterval) return;
      updateAccumulatorRef.current %= targetFrameInterval;
      update(frame.energy, frame.bass, frame.animationTimeMs);
    });
    update(0, 0, performance.now());
    return unsubscribe;
  }, [cues, duration, offsetMs, status]);

  useEffect(() => {
    if (activeIndex < 0) return;
    const scroller = scrollerRef.current;
    const active = scroller?.querySelector<HTMLElement>('[data-active="true"]');
    if (!scroller || !active) return;
    const target = Math.max(
      0,
      active.offsetTop - (scroller.clientHeight - active.offsetHeight) / 2,
    );
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reducedMotion) {
      scroller.scrollTop = target;
      return;
    }
    const scrollTween = gsap.to(scroller, {
      scrollTop: target,
      duration: 0.68,
      ease: 'power3.out',
      overwrite: true,
    });
    const lineTween = gsap.fromTo(
      active,
      { y: 14, opacity: 0.46, scale: 0.985 },
      { y: 0, opacity: 1, scale: 1, duration: 0.46, ease: 'power3.out', overwrite: true },
    );
    const translation = active.querySelector<HTMLElement>('[data-role="translation"]');
    const translationTween = translation
      ? gsap.fromTo(
          translation,
          { y: 7, opacity: 0.2 },
          { y: 0, opacity: 1, duration: 0.42, delay: 0.07, ease: 'power2.out' },
        )
      : null;
    return () => {
      scrollTween.kill();
      lineTween.kill();
      translationTween?.kill();
    };
  }, [activeIndex]);

  return (
    <div className="immersive-lyrics" ref={rootRef}>
      <LyricParticleLayer
        activeIndex={activeIndex}
        cueProgressRef={cueProgressRef}
        scrollerRef={scrollerRef}
      />
      <div className="immersive-lyrics__scroller" ref={scrollerRef}>
        {!currentTrackId && (
          <ImmersiveLyricsState title="等待播放" detail="选择一首歌曲后，歌词会在这里流动。" />
        )}
        {currentTrackId && status === 'loading' && (
          <ImmersiveLyricsState title="正在读取歌词" detail="正在检查本地同步歌词…" loading />
        )}
        {currentTrackId && status === 'missing' && (
          <ImmersiveLyricsState title="暂无同步歌词" detail="退出沉浸模式后可以在线匹配或生成本地歌词。" />
        )}
        {currentTrackId && status === 'error' && (
          <ImmersiveLyricsState title="歌词无法显示" detail={error ?? '歌词文件无法读取，但不会影响播放。'} />
        )}
        {status === 'loaded' && (
          <div className="immersive-lyrics__lines">
            <div className="immersive-lyrics__spacer" />
            {cues.map((cue, index) => (
              <button
                className="immersive-lyric-line"
                data-cue-index={index}
                data-active={index === activeIndex}
                data-position={index < activeIndex ? 'past' : index > activeIndex ? 'future' : 'current'}
                key={cue.id}
                type="button"
                tabIndex={index === activeIndex ? 0 : -1}
                aria-current={index === activeIndex ? 'true' : undefined}
                onClick={() => seekPlayback(cue.time + offsetMs / 1_000)}
                title={`跳转到 ${formatTime(Math.max(0, cue.time + offsetMs / 1_000))}`}
              >
                {cue.lines.map((line) => (
                  <span
                    className={`immersive-lyric-line__text immersive-lyric-line__text--${line.role}${line.role === 'original' && line.tokens?.length ? ' immersive-lyric-line__text--timed' : ''}`}
                    data-role={line.role}
                    key={line.id}
                    lang={line.role === 'translation' ? 'zh-CN' : 'und'}
                  >
                    {line.role === 'original' && line.tokens?.length
                      ? line.tokens.map((token, tokenIndex) => (
                          <span
                            className="immersive-lyric-token"
                            data-lyric-token
                            data-token-state="future"
                            key={`${line.id}-token-${tokenIndex}`}
                          >{token.text}</span>
                        ))
                      : line.text || '· · ·'}
                  </span>
                ))}
              </button>
            ))}
            <div className="immersive-lyrics__spacer" />
          </div>
        )}
      </div>
    </div>
  );
}

function ImmersiveLyricsState({
  title,
  detail,
  loading = false,
}: {
  title: string;
  detail: string;
  loading?: boolean;
}) {
  return (
    <div className="immersive-lyrics__state">
      <span data-loading={loading}><Icon name="lyrics" /></span>
      <strong>{title}</strong>
      <p>{detail}</p>
    </div>
  );
}
