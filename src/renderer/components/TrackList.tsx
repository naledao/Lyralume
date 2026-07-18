import type { Track } from '../../shared/contracts';
import { formatFileSize, formatTime } from '../lib/format';
import { useAppStore } from '../store/useAppStore';
import { Artwork } from './Artwork';
import { Icon } from './Icon';

export function TrackList({ tracks }: { tracks: Track[] }) {
  const currentTrackId = useAppStore((state) => state.currentTrackId);
  const isPlaying = useAppStore((state) => state.isPlaying);
  const selectTrack = useAppStore((state) => state.selectTrack);
  const togglePlayback = useAppStore((state) => state.togglePlayback);

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
        <span>#</span><span>歌曲</span><span>专辑</span><span>大小</span><span>时长</span>
      </div>
      <div className="track-table__body">
        {tracks.map((track, index) => {
          const active = currentTrackId === track.id;
          return (
            <button
              className={`track-row${active ? ' track-row--active' : ''}`}
              type="button"
              role="row"
              key={track.id}
              onClick={() => active ? togglePlayback() : selectTrack(track.id, true)}
              aria-label={`${active && isPlaying ? '暂停' : '播放'} ${track.title}，${track.artist}`}
            >
              <span className="track-row__index">
                {active ? <Icon name={isPlaying ? 'pause' : 'play'} /> : String(index + 1).padStart(2, '0')}
              </span>
              <span className="track-row__identity">
                <Artwork track={track} />
                <span><strong>{track.title}</strong><small>{track.artist}</small></span>
              </span>
              <span className="track-row__album">
                {track.album}
                {track.hasLyrics && <i title="有同名 LRC">LRC</i>}
              </span>
              <span>{formatFileSize(track.fileSize)}</span>
              <span>{formatTime(track.duration)}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
