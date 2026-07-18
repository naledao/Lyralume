import { useEffect, useMemo, useRef, useState } from 'react';
import type { OnlineLyricsCandidate, OnlineLyricsTask, Track } from '../../shared/contracts';
import { findActiveLyricIndex } from '../../shared/lrc';
import { audioEngine } from '../audio/AudioEngine';
import { withReleasedTrackSource } from '../audio/withReleasedTrackSource';
import { formatTime } from '../lib/format';
import { currentTrackFromState, useAppStore } from '../store/useAppStore';
import { Icon } from './Icon';

export function LyricsPanel() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [onlineMode, setOnlineMode] = useState(false);
  const track = useAppStore(currentTrackFromState);
  const currentTrackId = useAppStore((state) => state.currentTrackId);
  const status = useAppStore((state) => state.lyricsStatus);
  const lines = useAppStore((state) => state.lyricLines);
  const currentTime = useAppStore((state) => state.currentTime);
  const offsetMs = useAppStore((state) => state.lyricOffsetMs);
  const error = useAppStore((state) => state.lyricsError);
  const task = useAppStore((state) => state.onlineLyricsTask);
  const onlineBusy = useAppStore((state) => state.onlineLyricsBusy);
  const adjustOffset = useAppStore((state) => state.adjustLyricOffset);
  const resetOffset = useAppStore((state) => state.resetLyricOffset);
  const searchOnline = useAppStore((state) => state.searchOnlineLyrics);
  const updateTrackMetadata = useAppStore((state) => state.updateTrackMetadata);
  const writeTag = useAppStore((state) => state.writeOnlineLyricsTag);
  const activeIndex = useMemo(
    () => findActiveLyricIndex(lines, currentTime, offsetMs),
    [lines, currentTime, offsetMs],
  );

  useEffect(() => setOnlineMode(false), [currentTrackId]);

  useEffect(() => {
    if (onlineMode) return;
    const active = containerRef.current?.querySelector<HTMLElement>('[data-active="true"]');
    active?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [activeIndex, onlineMode]);

  const startOnlineSearch = (): void => {
    setOnlineMode(true);
    void searchOnline();
  };

  const fillCandidateTitle = async (candidate: OnlineLyricsCandidate): Promise<boolean> => {
    if (!track || !candidate.trackName.trim()) return false;
    return withReleasedTrackSource(
      track,
      () => updateTrackMetadata(track.id, { title: candidate.trackName }),
    );
  };

  const fillCandidateArtist = async (candidate: OnlineLyricsCandidate): Promise<boolean> => {
    if (!track || !candidate.artistName.trim()) return false;
    return withReleasedTrackSource(
      track,
      () => updateTrackMetadata(track.id, { artist: candidate.artistName }),
    );
  };

  const fillCandidateAlbum = async (candidate: OnlineLyricsCandidate): Promise<boolean> => {
    if (!track || !candidate.albumName.trim()) return false;
    return withReleasedTrackSource(
      track,
      () => updateTrackMetadata(track.id, { album: candidate.albumName }),
    );
  };

  const handleWriteTag = async (candidateId?: number): Promise<void> => {
    if (!track) return;
    await withReleasedTrackSource(track, () => writeTag(candidateId));
  };

  return (
    <aside className="lyrics-panel">
      <div className="panel-heading">
        <div><Icon name="lyrics" /><span>{onlineMode ? '在线歌词' : '同步歌词'}</span></div>
        <div className="panel-heading__actions">
          {!onlineMode && currentTrackId && (
            <button type="button" onClick={startOnlineSearch}>在线匹配</button>
          )}
          {onlineMode && <span className="status-pill"><i />LRCLIB</span>}
          {!onlineMode && status === 'loaded' && <span className="status-pill"><i />LRC</span>}
        </div>
      </div>

      <div
        className={onlineMode ? 'lyrics-panel__body lyrics-panel__body--online' : 'lyrics-panel__body'}
        ref={containerRef}
      >
        {onlineMode ? (
          <OnlineLyricsView
            track={track}
            task={task}
            busy={onlineBusy}
            onSearch={startOnlineSearch}
            onWriteLyrics={(candidateId) => void handleWriteTag(candidateId)}
            onFillTitle={fillCandidateTitle}
            onFillArtist={fillCandidateArtist}
            onFillAlbum={fillCandidateAlbum}
          />
        ) : (
          <>
            {!currentTrackId && <LyricsState icon="music" title="等待播放" detail="选择一首歌曲后，这里会显示同名 LRC。" />}
            {currentTrackId && status === 'loading' && <LyricsState icon="lyrics" title="正在读取歌词" detail="检查歌曲旁边的同名 LRC 文件…" loading />}
            {currentTrackId && status === 'missing' && (
              <LyricsState
                icon="lyrics"
                title="暂无本地歌词"
                detail="可以从 LRCLIB 查询同步歌词；保存前会让你确认匹配结果。"
                action={<button type="button" onClick={startOnlineSearch}>查询在线歌词</button>}
              />
            )}
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
          </>
        )}
      </div>

      {onlineMode ? (
        <div className="online-lyrics__footer">
          <span>歌词与歌曲信息均直接写入原音频文件</span>
          <button type="button" onClick={() => setOnlineMode(false)}>返回本地歌词</button>
        </div>
      ) : (
        <div className="lyrics-offset" aria-label="歌词整体偏移">
          <div><span>时间偏移</span><strong>{offsetMs > 0 ? '+' : ''}{(offsetMs / 1000).toFixed(1)}s</strong></div>
          <div>
            <button type="button" onClick={() => adjustOffset(-500)} disabled={status !== 'loaded'}>-0.5s</button>
            <button type="button" onClick={resetOffset} disabled={status !== 'loaded'}>重置</button>
            <button type="button" onClick={() => adjustOffset(500)} disabled={status !== 'loaded'}>+0.5s</button>
          </div>
        </div>
      )}
    </aside>
  );
}

function OnlineLyricsView({
  track,
  task,
  busy,
  onSearch,
  onWriteLyrics,
  onFillTitle,
  onFillArtist,
  onFillAlbum,
}: {
  track: Track | null;
  task: OnlineLyricsTask | null;
  busy: boolean;
  onSearch: () => void;
  onWriteLyrics: (candidateId: number) => void;
  onFillTitle: (candidate: OnlineLyricsCandidate) => Promise<boolean>;
  onFillArtist: (candidate: OnlineLyricsCandidate) => Promise<boolean>;
  onFillAlbum: (candidate: OnlineLyricsCandidate) => Promise<boolean>;
}) {
  if (!task || task.status === 'idle') {
    return (
      <LyricsState
        icon="sparkles"
        title="从 LRCLIB 匹配同步歌词"
        detail="将使用标题、艺术家、专辑和时长评分。歌词、歌曲名、艺术家和专辑均可分别写入原音频并回读验证。"
        action={<button type="button" onClick={onSearch} disabled={busy}>开始查询</button>}
      />
    );
  }

  if (task.status === 'querying') {
    return <LyricsState icon="sparkles" title="正在查询 LRCLIB" detail="正在比较歌曲信息和可用的同步歌词…" loading />;
  }

  if (task.status === 'saving') {
    return <LyricsState icon="lyrics" title="正在安全保存 LRC" detail="先写入同目录临时文件，再原子落盘…" loading />;
  }

  if (task.status === 'writing_tag') {
    return <LyricsState icon="lyrics" title="正在写入并回读验证" detail="请保持歌曲暂停，完成后会恢复原来的播放位置。" loading />;
  }

  if (task.tagWriteStatus === 'verified') {
    return (
      <div className="online-result">
        <div className="online-result__icon"><Icon name="sparkles" /></div>
        <strong>同步歌词已写入原音频</strong>
        <p>Kid3 回读结果与所选候选歌词一致，没有在歌曲旁生成 LRC 文件。</p>
        {task.error && <div className="online-error" role="alert">{task.error.message}</div>}
        <button className="online-action online-action--secondary" type="button" onClick={onSearch} disabled={busy}>
          重新查询
        </button>
      </div>
    );
  }

  if (task.candidates.length > 0) {
    return (
      <div className="online-candidates">
        <div className="online-candidates__heading">
          <strong>确认匹配结果</strong>
          <button type="button" onClick={onSearch} disabled={busy}><Icon name="refresh" />重新查询</button>
        </div>
        {task.error && <div className="online-error" role="alert">{task.error.message}</div>}
        {task.candidates.map((candidate) => (
          <CandidateCard
            key={candidate.id}
            track={track}
            candidate={candidate}
            busy={busy}
            onWriteLyrics={onWriteLyrics}
            onFillTitle={onFillTitle}
            onFillArtist={onFillArtist}
            onFillAlbum={onFillAlbum}
          />
        ))}
      </div>
    );
  }

  return (
    <LyricsState
      icon="lyrics"
      title="没有可用的同步歌词"
      detail={task.error?.message ?? '当前查询没有返回可用候选。'}
      action={<button type="button" onClick={onSearch} disabled={busy}>重试查询</button>}
    />
  );
}

export function CandidateCard({
  track,
  candidate,
  busy,
  onWriteLyrics,
  onFillTitle,
  onFillArtist,
  onFillAlbum,
}: {
  track: Track | null;
  candidate: OnlineLyricsCandidate;
  busy: boolean;
  onWriteLyrics: (candidateId: number) => void;
  onFillTitle: (candidate: OnlineLyricsCandidate) => Promise<boolean>;
  onFillArtist: (candidate: OnlineLyricsCandidate) => Promise<boolean>;
  onFillAlbum: (candidate: OnlineLyricsCandidate) => Promise<boolean>;
}) {
  const [metadataBusy, setMetadataBusy] = useState<'title' | 'artist' | 'album' | null>(null);
  const titleAvailable = Boolean(candidate.trackName.trim());
  const artistAvailable = Boolean(candidate.artistName.trim());
  const albumAvailable = Boolean(candidate.albumName.trim());
  const titleMatches = titleAvailable
    && track?.title.trim().toLocaleLowerCase() === candidate.trackName.trim().toLocaleLowerCase();
  const artistMatches = artistAvailable
    && track?.artist.trim().toLocaleLowerCase() === candidate.artistName.trim().toLocaleLowerCase();
  const albumMatches = albumAvailable
    && track?.album.trim().toLocaleLowerCase() === candidate.albumName.trim().toLocaleLowerCase();

  const fillMetadata = async (field: 'title' | 'artist' | 'album'): Promise<void> => {
    setMetadataBusy(field);
    try {
      if (field === 'title') await onFillTitle(candidate);
      else if (field === 'artist') await onFillArtist(candidate);
      else await onFillAlbum(candidate);
    } finally {
      setMetadataBusy(null);
    }
  };

  return (
    <article className={candidate.recommended ? 'candidate-card candidate-card--recommended' : 'candidate-card'}>
      <div className="candidate-card__title">
        <strong>{candidate.trackName}</strong>
        <span>{candidate.score} 分</span>
      </div>
      <p>{candidate.artistName} · {candidate.albumName || '未知专辑'}</p>
      <small>
        {formatTime(candidate.duration)} · 时长差 {candidate.durationDelta.toFixed(1)}s
        {candidate.recommended ? ' · 推荐' : ''}
      </small>
      <blockquote>{candidate.preview || '同步歌词预览不可用'}</blockquote>
      <div className="candidate-card__actions">
        <button type="button" disabled={busy} onClick={() => onWriteLyrics(candidate.id)}>写入歌词</button>
        <div className="candidate-card__metadata-actions">
          <button
            type="button"
            disabled={busy || metadataBusy !== null || !titleAvailable || titleMatches}
            onClick={() => void fillMetadata('title')}
          >
            {metadataBusy === 'title'
              ? '正在补全歌曲名'
              : titleMatches ? '歌曲名已一致' : '补全歌曲名'}
          </button>
          <button
            type="button"
            disabled={busy || metadataBusy !== null || !artistAvailable || artistMatches}
            onClick={() => void fillMetadata('artist')}
          >
            {metadataBusy === 'artist'
              ? '正在补全艺术家'
              : artistMatches ? '艺术家已一致' : '补全艺术家'}
          </button>
          <button
            type="button"
            disabled={busy || metadataBusy !== null || !albumAvailable || albumMatches}
            onClick={() => void fillMetadata('album')}
          >
            {metadataBusy === 'album'
              ? '正在补全专辑'
              : albumMatches ? '专辑已一致' : '补全专辑'}
          </button>
        </div>
      </div>
    </article>
  );
}

function LyricsState({ icon, title, detail, loading = false, action }: {
  icon: 'music' | 'lyrics' | 'sparkles';
  title: string;
  detail: string;
  loading?: boolean;
  action?: React.ReactNode;
}) {
  return (
    <div className="lyrics-state">
      <div className={loading ? 'lyrics-state__icon lyrics-state__icon--loading' : 'lyrics-state__icon'}><Icon name={icon} /></div>
      <strong>{title}</strong>
      <p>{detail}</p>
      {action && <div className="lyrics-state__action">{action}</div>}
    </div>
  );
}
