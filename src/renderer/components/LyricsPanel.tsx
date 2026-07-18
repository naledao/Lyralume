import { useEffect, useMemo, useRef } from 'react';
import { findActiveLyricIndex } from '../../shared/lrc';
import { audioEngine } from '../audio/AudioEngine';
import { useAppStore } from '../store/useAppStore';
import { Icon } from './Icon';

export function LyricsPanel() {
  const containerRef = useRef<HTMLDivElement>(null);
  const currentTrackId = useAppStore((state) => state.currentTrackId);
  const status = useAppStore((state) => state.lyricsStatus);
  const lines = useAppStore((state) => state.lyricLines);
  const currentTime = useAppStore((state) => state.currentTime);
  const offsetMs = useAppStore((state) => state.lyricOffsetMs);
  const error = useAppStore((state) => state.lyricsError);
  const adjustOffset = useAppStore((state) => state.adjustLyricOffset);
  const resetOffset = useAppStore((state) => state.resetLyricOffset);
  const activeIndex = useMemo(
    () => findActiveLyricIndex(lines, currentTime, offsetMs),
    [lines, currentTime, offsetMs],
  );

  useEffect(() => {
    const active = containerRef.current?.querySelector<HTMLElement>('[data-active="true"]');
    active?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [activeIndex]);

  return (
    <aside className="lyrics-panel">
      <div className="panel-heading">
        <div><Icon name="lyrics" /><span>同步歌词</span></div>
        {status === 'loaded' && <span className="status-pill"><i />LRC</span>}
      </div>

      <div className="lyrics-panel__body" ref={containerRef}>
        {!currentTrackId && <LyricsState icon="music" title="等待播放" detail="选择一首歌曲后，这里会显示同名 LRC。" />}
        {currentTrackId && status === 'loading' && <LyricsState icon="lyrics" title="正在读取歌词" detail="检查歌曲旁边的同名 LRC 文件…" loading />}
        {currentTrackId && status === 'missing' && <LyricsState icon="lyrics" title="暂无本地歌词" detail="将同名 .lrc 文件放在歌曲旁边，重新扫描后即可显示。" />}
        {currentTrackId && status === 'error' && <LyricsState icon="lyrics" title="歌词无法显示" detail={error ?? '文件损坏，但不会影响歌曲播放。'} />}
        {status === 'loaded' && (
          <div className="lyric-lines">
            <div className="lyric-lines__spacer" />
            {lines.map((line, index) => (
              <button
                type="button"
                className="lyric-line"
                data-active={index === activeIndex}
                key={line.id}
                onClick={() => audioEngine.seek(line.time + offsetMs / 1000)}
              >
                {line.text || '· · ·'}
              </button>
            ))}
            <div className="lyric-lines__spacer" />
          </div>
        )}
      </div>

      <div className="lyrics-offset" aria-label="歌词整体偏移">
        <div><span>时间偏移</span><strong>{offsetMs > 0 ? '+' : ''}{(offsetMs / 1000).toFixed(1)}s</strong></div>
        <div>
          <button type="button" onClick={() => adjustOffset(-500)} disabled={status !== 'loaded'}>-0.5s</button>
          <button type="button" onClick={resetOffset} disabled={status !== 'loaded'}>重置</button>
          <button type="button" onClick={() => adjustOffset(500)} disabled={status !== 'loaded'}>+0.5s</button>
        </div>
      </div>
    </aside>
  );
}

function LyricsState({ icon, title, detail, loading = false }: {
  icon: 'music' | 'lyrics';
  title: string;
  detail: string;
  loading?: boolean;
}) {
  return (
    <div className="lyrics-state">
      <div className={loading ? 'lyrics-state__icon lyrics-state__icon--loading' : 'lyrics-state__icon'}><Icon name={icon} /></div>
      <strong>{title}</strong>
      <p>{detail}</p>
    </div>
  );
}
