import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  BilingualLyricsStartOptions,
  LocalLyricsProofreadProgress,
  LocalLyricsTask,
  OnlineLyricsCandidate,
  OnlineLyricsTask,
  Track,
} from '../../shared/contracts';
import { findActiveLyricIndex, groupLyricLines } from '../../shared/lrc';
import { audioEngine } from '../audio/AudioEngine';
import { seekPlayback } from '../audio/seekPlayback';
import {
  checkpointFromSnapshot,
  persistPlaybackCheckpoint,
} from '../audio/playbackCheckpoints';
import { withReleasedTrackSource } from '../audio/withReleasedTrackSource';
import { formatTime } from '../lib/format';
import { currentTrackFromState, useAppStore } from '../store/useAppStore';
import { Icon } from './Icon';
import { BilingualLyricsView } from './BilingualLyricsView';
import { LocalLyricsEditor } from './LocalLyricsEditor';

const EMPTY_LOCAL_LYRICS_PROOFREAD_PROGRESS: LocalLyricsProofreadProgress[] = [];

export function LyricsPanel() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [onlineMode, setOnlineMode] = useState(false);
  const [localMode, setLocalMode] = useState(false);
  const [bilingualMode, setBilingualMode] = useState(false);
  const track = useAppStore(currentTrackFromState);
  const currentTrackId = useAppStore((state) => state.currentTrackId);
  const status = useAppStore((state) => state.lyricsStatus);
  const lines = useAppStore((state) => state.lyricLines);
  const currentTime = useAppStore((state) => state.currentTime);
  const offsetMs = useAppStore((state) => state.lyricOffsetMs);
  const lyricsSource = useAppStore((state) => state.lyricsSource);
  const lyricsRevision = useAppStore((state) => state.lyricsRevision);
  const timingWriteBusy = useAppStore((state) => state.lyricTimingWriteBusy);
  const timingWriteError = useAppStore((state) => state.lyricTimingWriteError);
  const timingWriteMessage = useAppStore((state) => state.lyricTimingWriteMessage);
  const error = useAppStore((state) => state.lyricsError);
  const task = useAppStore((state) => state.onlineLyricsTask);
  const onlineBusy = useAppStore((state) => state.onlineLyricsBusy);
  const localTask = useAppStore((state) => state.localLyricsTask);
  const localTasks = useAppStore((state) => state.localLyricsTasks);
  const localBusy = useAppStore((state) => state.localLyricsBusy);
  const localProofreadBusy = useAppStore((state) => state.localLyricsProofreadBusy);
  const localProofreadError = useAppStore((state) => state.localLyricsProofreadError);
  const localProofreadProgress = useAppStore((state) => (
    currentTrackId
      ? state.localLyricsProofreadProgress[currentTrackId] ?? EMPTY_LOCAL_LYRICS_PROOFREAD_PROGRESS
      : EMPTY_LOCAL_LYRICS_PROOFREAD_PROGRESS
  ));
  const localModelSettings = useAppStore((state) => state.localLyricsModelSettings);
  const localModelSettingsBusy = useAppStore((state) => state.localLyricsModelSettingsBusy);
  const localModelSettingsError = useAppStore((state) => state.localLyricsModelSettingsError);
  const bilingualTask = useAppStore((state) => state.bilingualLyricsTask);
  const bilingualBusy = useAppStore((state) => state.bilingualLyricsBusy);
  const adjustOffset = useAppStore((state) => state.adjustLyricOffset);
  const resetOffset = useAppStore((state) => state.resetLyricOffset);
  const searchOnline = useAppStore((state) => state.searchOnlineLyrics);
  const updateTrackMetadata = useAppStore((state) => state.updateTrackMetadata);
  const writeTag = useAppStore((state) => state.writeOnlineLyricsTag);
  const startLocal = useAppStore((state) => state.startLocalLyrics);
  const loadLocalModelSettings = useAppStore((state) => state.loadLocalLyricsModelSettings);
  const chooseLocalUvrModel = useAppStore((state) => state.chooseLocalUvrModel);
  const resetLocalUvrModel = useAppStore((state) => state.resetLocalUvrModel);
  const cancelLocal = useAppStore((state) => state.cancelLocalLyrics);
  const proofreadLocal = useAppStore((state) => state.proofreadLocalLyrics);
  const saveLocalDraft = useAppStore((state) => state.saveLocalLyricsDraft);
  const confirmLocalLrc = useAppStore((state) => state.confirmLocalLyricsLrc);
  const writeLocalTag = useAppStore((state) => state.writeLocalLyricsTag);
  const startBilingual = useAppStore((state) => state.startBilingualLyrics);
  const cancelBilingual = useAppStore((state) => state.cancelBilingualLyrics);
  const writeBilingualTag = useAppStore((state) => state.writeBilingualLyricsTag);
  const writeAdjustedTiming = useAppStore((state) => state.writeAdjustedLyricTiming);
  const selectTrack = useAppStore((state) => state.selectTrack);
  const rememberedTask = useMemo(() => (
    Object.values(localTasks)
      .filter((item) => item.trackId !== currentTrackId && item.status !== 'idle')
      .sort((left, right) => {
        const leftRunning = isRunningLocalTask(left) ? 1 : 0;
        const rightRunning = isRunningLocalTask(right) ? 1 : 0;
        return rightRunning - leftRunning || right.updatedAt - left.updatedAt;
      })[0] ?? null
  ), [currentTrackId, localTasks]);
  const rememberedTrack = useAppStore((state) => (
    rememberedTask ? state.tracks.find((item) => item.id === rememberedTask.trackId) ?? null : null
  ));
  const cues = useMemo(() => groupLyricLines(lines), [lines]);
  const activeIndex = useMemo(
    () => findActiveLyricIndex(cues, currentTime, offsetMs),
    [cues, currentTime, offsetMs],
  );

  useEffect(() => {
    setOnlineMode(false);
    setBilingualMode(false);
  }, [currentTrackId]);

  useEffect(() => {
    if (onlineMode || localMode || bilingualMode) return;
    const active = containerRef.current?.querySelector<HTMLElement>('[data-active="true"]');
    active?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [activeIndex, bilingualMode, localMode, onlineMode]);

  const startOnlineSearch = (): void => {
    setLocalMode(false);
    setBilingualMode(false);
    setOnlineMode(true);
    void searchOnline();
  };

  const showLocalDraft = (): void => {
    setOnlineMode(false);
    setBilingualMode(false);
    setLocalMode(true);
    void loadLocalModelSettings();
  };

  const showBilingualDraft = (): void => {
    setOnlineMode(false);
    setLocalMode(false);
    setBilingualMode(true);
  };

  const handleStartBilingual = (options: BilingualLyricsStartOptions): void => {
    showBilingualDraft();
    void startBilingual(options);
  };

  const handleStartLocal = async (
    options: Parameters<typeof startLocal>[0],
  ): Promise<void> => {
    if (!track) return;
    try {
      await persistPlaybackCheckpoint(checkpointFromSnapshot(
        track.id,
        audioEngine.getPlaybackSnapshot(),
        'file-operation',
        { fallbackDuration: track.duration },
      ));
    } catch (checkpointError) {
      console.warn('Playback progress could not be saved before the local lyrics task', checkpointError);
    }
    await startLocal(options);
  };

  const returnToRememberedTask = (): void => {
    if (!rememberedTask) return;
    setOnlineMode(false);
    setLocalMode(true);
    setBilingualMode(false);
    void loadLocalModelSettings();
    selectTrack(rememberedTask.trackId, false);
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

  const handleWriteLocalTag = async (
    update: Parameters<typeof writeLocalTag>[0],
  ): ReturnType<typeof writeLocalTag> => {
    if (!track) return null;
    return withReleasedTrackSource(track, () => writeLocalTag(update));
  };

  const handleWriteBilingualTag = async (): ReturnType<typeof writeBilingualTag> => {
    if (!track) return null;
    return withReleasedTrackSource(track, writeBilingualTag);
  };

  const handleWriteAdjustedTiming = async (): Promise<void> => {
    if (!track) return;
    await withReleasedTrackSource(track, writeAdjustedTiming);
  };

  const timingAlreadyEmbedded = lyricsSource === 'embedded' && offsetMs === 0;
  const canWriteAdjustedTiming = status === 'loaded'
    && Boolean(lyricsRevision)
    && !timingWriteBusy
    && !timingAlreadyEmbedded;

  return (
    <aside className="lyrics-panel">
      <div className="panel-heading">
        <div><Icon name="lyrics" /><span>{bilingualMode ? '中文双语草稿' : localMode ? '本地歌词草稿' : onlineMode ? '在线歌词' : '同步歌词'}</span></div>
        <div className="panel-heading__actions">
          {rememberedTask && rememberedTrack && (
            <button
              className="panel-heading__task-jump"
              type="button"
              title={`返回《${rememberedTrack.title}》的本地歌词任务`}
              onClick={returnToRememberedTask}
            >
              《{rememberedTrack.title}》· {localTaskStatusLabel(rememberedTask)}
            </button>
          )}
          {!onlineMode && !localMode && !bilingualMode && currentTrackId && (
            <button type="button" onClick={startOnlineSearch}>在线匹配</button>
          )}
          {!onlineMode && !localMode && !bilingualMode && currentTrackId && (
            <button
              className="panel-heading__local-action"
              type="button"
              title={localTask && localTask.status !== 'idle'
                ? '打开本机歌词任务，可校对或重新生成'
                : '在本机生成歌词草稿'}
              onClick={showLocalDraft}
            >
              本机生成
            </button>
          )}
          {!onlineMode && !localMode && !bilingualMode && status === 'loaded' && (
            <button type="button" onClick={showBilingualDraft}>中文译配</button>
          )}
          {onlineMode && <span className="status-pill"><i />LRCLIB</span>}
          {localMode && <span className="status-pill"><i />LOCAL AI</span>}
          {bilingualMode && <span className="status-pill"><i />CODEX</span>}
          {!onlineMode && !localMode && !bilingualMode && status === 'loaded' && <span className="status-pill"><i />LRC</span>}
        </div>
      </div>

      <div
        className={(onlineMode || localMode || bilingualMode) ? 'lyrics-panel__body lyrics-panel__body--online' : 'lyrics-panel__body'}
        ref={containerRef}
      >
        {bilingualMode && track ? (
          <BilingualLyricsView
            track={track}
            task={bilingualTask}
            busy={bilingualBusy}
            currentTime={currentTime}
            offsetMs={offsetMs}
            onStart={handleStartBilingual}
            onCancel={() => void cancelBilingual()}
            onWriteTag={handleWriteBilingualTag}
            onSeek={seekPlayback}
          />
        ) : localMode && track ? (
          <LocalLyricsEditor
            track={track}
            task={localTask}
            busy={localBusy}
            proofreadBusy={localProofreadBusy}
            proofreadError={localProofreadError}
            proofreadProgress={localProofreadProgress}
            modelSettings={localModelSettings}
            modelSettingsBusy={localModelSettingsBusy}
            modelSettingsError={localModelSettingsError}
            onChooseUvrModel={() => void chooseLocalUvrModel()}
            onResetUvrModel={() => void resetLocalUvrModel()}
            onStart={(options) => void handleStartLocal(options)}
            onCancel={() => void cancelLocal()}
            onProofread={proofreadLocal}
            onSaveDraft={saveLocalDraft}
            onConfirmLrc={confirmLocalLrc}
            onWriteTag={handleWriteLocalTag}
          />
        ) : onlineMode ? (
          <OnlineLyricsView
            track={track}
            task={task}
            busy={onlineBusy}
            onSearch={startOnlineSearch}
            onWriteLyrics={(candidateId) => void handleWriteTag(candidateId)}
            onFillTitle={fillCandidateTitle}
            onFillArtist={fillCandidateArtist}
            onFillAlbum={fillCandidateAlbum}
            onStartLocal={showLocalDraft}
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
                action={(
                  <div className="lyrics-state__actions">
                    <button type="button" onClick={startOnlineSearch}>查询在线歌词</button>
                    <button type="button" onClick={showLocalDraft}>本地生成草稿</button>
                  </div>
                )}
              />
            )}
            {currentTrackId && status === 'error' && <LyricsState icon="lyrics" title="歌词无法显示" detail={error ?? '文件损坏，但不会影响歌曲播放。'} />}
            {status === 'loaded' && (
              <div className="lyric-lines">
                <div className="lyric-lines__spacer" />
                {cues.map((cue, index) => (
                  <button
                    type="button"
                    className="lyric-line"
                    data-active={index === activeIndex}
                    key={cue.id}
                    onClick={() => seekPlayback(cue.time + offsetMs / 1000)}
                    title={`跳转到 ${formatTime(Math.max(0, cue.time + offsetMs / 1000))}`}
                  >
                    {cue.lines.map((line) => (
                      <span
                        className={`lyric-line__text lyric-line__text--${line.role}`}
                        key={line.id}
                        lang={line.role === 'translation' ? 'zh-CN' : 'und'}
                      >
                        {line.text || '· · ·'}
                      </span>
                    ))}
                  </button>
                ))}
                <div className="lyric-lines__spacer" />
              </div>
            )}
          </>
        )}
      </div>

      {bilingualMode ? (
        <div className="online-lyrics__footer">
          <span>
            {bilingualTask?.tagWriteStatus === 'verified'
              ? '双语同步歌词已写入 MP3，并通过回读验证'
              : '草稿需人工审阅；确认写入后只修改 MP3 歌词标签'}
          </span>
          <button type="button" onClick={() => setBilingualMode(false)}>返回同步歌词</button>
        </div>
      ) : localMode ? (
        <div className="online-lyrics__footer">
          <span>AI 结果始终作为草稿，确认前不会写入歌曲</span>
          <button type="button" onClick={() => setLocalMode(false)}>返回同步歌词</button>
        </div>
      ) : onlineMode ? (
        <div className="online-lyrics__footer">
          <span>歌词与歌曲信息均直接写入原音频文件</span>
          <button type="button" onClick={() => setOnlineMode(false)}>返回本地歌词</button>
        </div>
      ) : (
        <div className="lyrics-offset" aria-label="歌词整体偏移">
          <div className="lyrics-offset__heading">
            <span>时间偏移</span>
            <strong>{offsetMs > 0 ? '+' : ''}{(offsetMs / 1000).toFixed(1)}s</strong>
          </div>
          <div className="lyrics-offset__controls">
            <button type="button" onClick={() => adjustOffset(-500)} disabled={status !== 'loaded'}>-0.5s</button>
            <button type="button" onClick={resetOffset} disabled={status !== 'loaded'}>重置</button>
            <button type="button" onClick={() => adjustOffset(500)} disabled={status !== 'loaded'}>+0.5s</button>
          </div>
          <div className="lyrics-offset__write">
            <span
              className={timingWriteError ? 'lyrics-offset__status lyrics-offset__status--error' : 'lyrics-offset__status'}
              role={timingWriteError ? 'alert' : 'status'}
            >
              {timingWriteError
                ?? timingWriteMessage
                ?? (timingAlreadyEmbedded ? '当前时间已写入原音频' : '调整后写入同步歌词标签')}
            </span>
            <button
              type="button"
              className="lyrics-offset__write-button"
              disabled={!canWriteAdjustedTiming}
              onClick={() => void handleWriteAdjustedTiming()}
            >
              {timingWriteBusy ? '写入中…' : timingAlreadyEmbedded ? '已写入' : '应用并写入音频'}
            </button>
          </div>
        </div>
      )}
    </aside>
  );
}

function isRunningLocalTask(task: LocalLyricsTask): boolean {
  return ['queued', 'separating', 'transcribing', 'compiling'].includes(task.status);
}

function localTaskStatusLabel(task: LocalLyricsTask): string {
  if (isRunningLocalTask(task)) return `${Math.round(task.progress * 100)}%`;
  if (task.status === 'review') return '待校对';
  if (task.status === 'failed') return '失败';
  if (task.status === 'cancelled') return '已取消';
  if (task.status === 'lrc_saved') return 'LRC 已保存';
  if (task.status === 'completed') return '已完成';
  return '查看任务';
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
  onStartLocal,
}: {
  track: Track | null;
  task: OnlineLyricsTask | null;
  busy: boolean;
  onSearch: () => void;
  onWriteLyrics: (candidateId: number) => void;
  onFillTitle: (candidate: OnlineLyricsCandidate) => Promise<boolean>;
  onFillArtist: (candidate: OnlineLyricsCandidate) => Promise<boolean>;
  onFillAlbum: (candidate: OnlineLyricsCandidate) => Promise<boolean>;
  onStartLocal: () => void;
}) {
  if (!task || task.status === 'idle') {
    return (
      <LyricsState
        icon="sparkles"
        title="从 LRCLIB 匹配同步歌词"
        detail="将使用标题、艺术家、专辑和时长评分。歌词、歌曲名、艺术家和专辑均可分别写入原音频并回读验证。"
        action={(
          <div className="lyrics-state__actions">
            <button type="button" onClick={onSearch} disabled={busy}>开始查询</button>
            <button type="button" onClick={onStartLocal} disabled={busy}>本地生成草稿</button>
          </div>
        )}
      />
    );
  }

  if (task.status === 'querying') {
    return <LyricsState icon="sparkles" title="正在查询 LRCLIB" detail="正在匹配歌曲信息和同步歌词…" loading />;
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
        <div className="lyrics-state__actions">
          <button type="button" onClick={onSearch} disabled={busy}>重新查询</button>
        </div>
      </div>
    );
  }

  if (task.candidates.length > 0) {
    return (
      <div className="online-candidates">
        <div className="online-candidates__heading">
          <strong>确认匹配结果</strong>
          <button type="button" onClick={onSearch} disabled={busy}>重新查询</button>
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
      action={(
        <div className="lyrics-state__actions">
          <button type="button" onClick={onSearch} disabled={busy}>重试查询</button>
          <button type="button" onClick={onStartLocal} disabled={busy}>改用本地生成</button>
        </div>
      )}
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
