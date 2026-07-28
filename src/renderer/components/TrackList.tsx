import { useEffect, useRef, useState } from 'react';
import {
  TRACK_LANGUAGE_OPTIONS,
  UNKNOWN_ALBUM,
  UNKNOWN_ARTIST,
  type Track,
  type TrackLanguage,
  type TrackMetadataUpdate,
} from '../../shared/contracts';
import { withReleasedTrackSource } from '../audio/withReleasedTrackSource';
import { formatFileSize, formatTime } from '../lib/format';
import { useAppStore } from '../store/useAppStore';
import { Artwork } from './Artwork';
import { Icon } from './Icon';

export function TrackList({ tracks }: { tracks: Track[] }) {
  const currentTrackId = useAppStore((state) => state.currentTrackId);
  const isPlaying = useAppStore((state) => state.isPlaying);
  const selectTrack = useAppStore((state) => state.selectTrack);
  const togglePlayback = useAppStore((state) => state.togglePlayback);
  const updateTrackMetadata = useAppStore((state) => state.updateTrackMetadata);
  const removeTrack = useAppStore((state) => state.removeTrack);
  const [removingTrackId, setRemovingTrackId] = useState<string | null>(null);
  const [savingTrackId, setSavingTrackId] = useState<string | null>(null);
  const [savingArtworkTrackId, setSavingArtworkTrackId] = useState<string | null>(null);
  const [savingLanguageTrackIds, setSavingLanguageTrackIds] = useState<Set<string>>(new Set());
  const [metadataDraft, setMetadataDraft] = useState<{
    trackId: string;
    title: string;
    artist: string;
    album: string;
  } | null>(null);
  const clickTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (clickTimer.current) clearTimeout(clickTimer.current);
  }, []);

  const playTrack = (track: Track): void => {
    if (currentTrackId === track.id) togglePlayback();
    else selectTrack(track.id, true);
  };

  const schedulePlay = (track: Track): void => {
    if (clickTimer.current) clearTimeout(clickTimer.current);
    clickTimer.current = setTimeout(() => {
      clickTimer.current = null;
      playTrack(track);
    }, 180);
  };

  const startEditing = (track: Track): void => {
    if (clickTimer.current) clearTimeout(clickTimer.current);
    clickTimer.current = null;
    setMetadataDraft({
      trackId: track.id,
      title: track.title,
      artist: track.artist === UNKNOWN_ARTIST ? '' : track.artist,
      album: track.album === UNKNOWN_ALBUM ? '' : track.album,
    });
  };

  const cancelEditing = (): void => setMetadataDraft(null);

  const saveMetadata = async (): Promise<void> => {
    if (!metadataDraft || savingTrackId) return;
    const track = tracks.find((item) => item.id === metadataDraft.trackId);
    if (!track) return;
    const update: TrackMetadataUpdate = {};
    const title = metadataDraft.title.trim();
    const artist = metadataDraft.artist.trim();
    const album = metadataDraft.album.trim();
    update.title = title;
    update.artist = artist;
    update.album = album;
    setSavingTrackId(metadataDraft.trackId);
    try {
      const saved = await withReleasedTrackSource(
        track,
        () => updateTrackMetadata(metadataDraft.trackId, update),
      );
      if (saved) setMetadataDraft(null);
    } finally {
      setSavingTrackId(null);
    }
  };

  const handleEditorKeyDown = (event: React.KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Enter') {
      event.preventDefault();
      void saveMetadata();
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      cancelEditing();
    }
  };

  const handleRemove = async (track: Track): Promise<void> => {
    const confirmed = window.confirm(
      `要从 Lyralume 音乐库移除《${track.title}》吗？\n\n电脑上的音乐文件不会被删除。`,
    );
    if (!confirmed) return;
    setRemovingTrackId(track.id);
    try {
      await withReleasedTrackSource(track, () => removeTrack(track.id));
    } finally {
      setRemovingTrackId(null);
    }
  };

  const changeArtwork = async (track: Track): Promise<void> => {
    if (!track.fileName.toLocaleLowerCase().endsWith('.mp3')) {
      window.alert('当前仅支持修改 MP3 文件的封面。');
      return;
    }
    if (track.hasArtwork && !window.confirm(`要替换《${track.title}》当前的内嵌封面吗？`)) return;
    setSavingArtworkTrackId(track.id);
    useAppStore.setState({ libraryMessage: `正在修改《${track.title}》的 MP3 封面…` });
    try {
      await withReleasedTrackSource(track, async () => {
        const snapshot = await window.lyralume.library.chooseArtwork(track.id);
        if (snapshot) {
          useAppStore.getState().applySnapshot(snapshot);
          useAppStore.setState({ libraryMessage: `已修改《${track.title}》的 MP3 封面并完成回读验证` });
        } else {
          useAppStore.setState({ libraryMessage: null });
        }
      });
    } catch (error) {
      useAppStore.setState({
        libraryMessage: error instanceof Error ? error.message : 'MP3 封面写入失败',
      });
    } finally {
      setSavingArtworkTrackId(null);
    }
  };

  const saveLanguage = async (
    track: Track,
    language: TrackLanguage | '',
  ): Promise<void> => {
    if (savingLanguageTrackIds.has(track.id) || (track.language ?? '') === language) return;
    setSavingLanguageTrackIds((current) => new Set(current).add(track.id));
    try {
      const operation = () => updateTrackMetadata(track.id, { language });
      if (track.fileName.toLocaleLowerCase().endsWith('.mp3')) {
        await withReleasedTrackSource(track, operation);
      } else {
        await operation();
      }
    } finally {
      setSavingLanguageTrackIds((current) => {
        const next = new Set(current);
        next.delete(track.id);
        return next;
      });
    }
  };

  if (tracks.length === 0) {
    return (
      <div className="track-empty">
        <Icon name="music" />
        <strong>没有符合条件的歌曲</strong>
        <span>换一个关键词，或从左侧导入音乐文件夹。</span>
      </div>
    );
  }

  return (
    <div className="track-table" role="table" aria-label="音乐库歌曲">
      <div className="track-table__header" role="row">
        <span>#</span><span>歌曲</span><span>专辑</span><span>语种</span><span>大小</span><span>时长</span><span aria-hidden="true" />
      </div>
      <div className="track-table__body">
        {tracks.map((track, index) => {
          const active = currentTrackId === track.id;
          const editing = metadataDraft?.trackId === track.id;
          const saving = savingTrackId === track.id;
          const savingLanguage = savingLanguageTrackIds.has(track.id);
          const canSave = Boolean(metadataDraft);
          return (
            <div
              className={`track-row${active ? ' track-row--active' : ''}${editing ? ' track-row--editing' : ''}`}
              role="row"
              key={track.id}
            >
              {!editing && (
                <button
                  className="track-row__play"
                  type="button"
                  onClick={() => schedulePlay(track)}
                  onDoubleClick={(event) => {
                    event.preventDefault();
                    startEditing(track);
                  }}
                  title="单击播放，双击编辑歌曲信息"
                  aria-label={`${active && isPlaying ? '暂停' : '播放'} ${track.title}，双击编辑歌曲信息`}
                />
              )}
              <span className="track-row__index" role="cell">
                {active ? <Icon name={isPlaying ? 'pause' : 'play'} /> : String(index + 1).padStart(2, '0')}
              </span>
              <span className="track-row__identity" role="cell">
                <Artwork track={track} />
                <span>
                  {editing ? (
                    <>
                      <input
                        autoFocus
                        className="track-row__title-input"
                        aria-label={`${track.title} 的歌曲名`}
                        maxLength={300}
                        value={metadataDraft.title}
                        onChange={(event) => setMetadataDraft({ ...metadataDraft, title: event.target.value })}
                        onKeyDown={handleEditorKeyDown}
                      />
                      <input
                        aria-label={`${track.title} 的艺术家`}
                        maxLength={300}
                        placeholder="未填写艺术家"
                        value={metadataDraft.artist}
                        onChange={(event) => setMetadataDraft({ ...metadataDraft, artist: event.target.value })}
                        onKeyDown={handleEditorKeyDown}
                      />
                    </>
                  ) : (
                    <>
                      <strong>{track.title}</strong>
                      <small>{track.artist}</small>
                    </>
                  )}
                </span>
              </span>
              <span className="track-row__album" role="cell">
                {editing ? (
                  <input
                    aria-label={`${track.title} 的专辑`}
                    maxLength={300}
                    placeholder="未填写专辑"
                    value={metadataDraft.album}
                    onChange={(event) => setMetadataDraft({ ...metadataDraft, album: event.target.value })}
                    onKeyDown={handleEditorKeyDown}
                  />
                ) : (
                  <>
                    {track.album}
                    {track.hasLyrics && <i title="有同名 LRC">LRC</i>}
                  </>
                )}
              </span>
              <div
                className="track-row__language"
                role="cell"
                aria-busy={savingLanguage}
              >
                <select
                  className="track-language-select"
                  data-language={track.language ?? 'unset'}
                  aria-label={`设置 ${track.title} 的语种`}
                  title={savingLanguage ? '正在保存语种…' : '语种标签'}
                  disabled={savingLanguage}
                  value={track.language ?? ''}
                  onChange={(event) => {
                    void saveLanguage(track, event.target.value as TrackLanguage | '');
                  }}
                >
                  <option value="">未设置</option>
                  {TRACK_LANGUAGE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </div>
              <span className="track-row__size" role="cell">{formatFileSize(track.fileSize)}</span>
              <span role="cell">{formatTime(track.duration)}</span>
              <div className="track-row__actions" onDoubleClick={(event) => event.stopPropagation()}>
                {editing ? (
                  <>
                    <button
                      className="track-row__save"
                      type="button"
                      disabled={!canSave || saving}
                      onClick={() => void saveMetadata()}
                    >
                      {saving ? '写入中' : '保存到文件'}
                    </button>
                    <button type="button" disabled={saving} onClick={cancelEditing}>取消</button>
                  </>
                ) : (
                  <>
                    <button
                      className="track-row__artwork"
                      type="button"
                      title={track.hasArtwork ? '替换 MP3 封面' : '添加 MP3 封面'}
                      aria-label={`${track.hasArtwork ? '替换' : '添加'} ${track.title} 的 MP3 封面`}
                      disabled={savingArtworkTrackId === track.id}
                      onClick={() => void changeArtwork(track)}
                    >
                      <Icon name="image" />
                    </button>
                    <button
                      className="track-row__edit"
                      type="button"
                      title="编辑歌曲名、艺术家和专辑"
                      aria-label={`编辑 ${track.title} 的歌曲信息`}
                      onClick={() => startEditing(track)}
                    >
                      <Icon name="edit" />
                    </button>
                    <button
                      className="track-row__remove"
                      type="button"
                      title="从音乐库移除（不删除文件）"
                      aria-label={`从音乐库移除 ${track.title}，不删除文件`}
                      disabled={removingTrackId === track.id}
                      onClick={() => void handleRemove(track)}
                    >
                      <Icon name="remove" />
                    </button>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
