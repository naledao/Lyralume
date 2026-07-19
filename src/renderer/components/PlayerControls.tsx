import { audioEngine } from '../audio/AudioEngine';
import { formatTime } from '../lib/format';
import { currentTrackFromState, useAppStore } from '../store/useAppStore';
import { Artwork } from './Artwork';
import { Icon } from './Icon';

const PLAYBACK_MODE_LABELS = {
  sequence: '顺序播放',
  shuffle: '列表随机',
  'repeat-one': '单曲循环',
} as const;

const PLAYBACK_MODE_ICONS = {
  sequence: 'sequence',
  shuffle: 'shuffle',
  'repeat-one': 'repeatOne',
} as const;

export function PlayerControls() {
  const track = useAppStore(currentTrackFromState);
  const isPlaying = useAppStore((state) => state.isPlaying);
  const currentTime = useAppStore((state) => state.currentTime);
  const duration = useAppStore((state) => state.duration);
  const volume = useAppStore((state) => state.volume);
  const playbackError = useAppStore((state) => state.playbackError);
  const playbackMode = useAppStore((state) => state.playbackMode);
  const togglePlayback = useAppStore((state) => state.togglePlayback);
  const nextTrack = useAppStore((state) => state.nextTrack);
  const previousTrack = useAppStore((state) => state.previousTrack);
  const cyclePlaybackMode = useAppStore((state) => state.cyclePlaybackMode);
  const setVolume = useAppStore((state) => state.setVolume);
  const safeDuration = Math.max(duration || track?.duration || 0, 0);

  return (
    <footer className="player-bar">
      <div className="player-track">
        <Artwork track={track} />
        <div>
          <strong>{track?.title ?? '还没有播放歌曲'}</strong>
          <span>{playbackError ?? track?.artist ?? '从音乐库中选择一首歌'}</span>
        </div>
      </div>

      <div className="transport">
        <div className="transport__buttons">
          <button
            className="transport__mode"
            type="button"
            onClick={cyclePlaybackMode}
            data-mode={playbackMode}
            aria-label={`播放模式：${PLAYBACK_MODE_LABELS[playbackMode]}，点击切换`}
            title={PLAYBACK_MODE_LABELS[playbackMode]}
          >
            <Icon name={PLAYBACK_MODE_ICONS[playbackMode]} />
            <span>{PLAYBACK_MODE_LABELS[playbackMode]}</span>
          </button>
          <button type="button" onClick={previousTrack} disabled={!track} aria-label="上一首"><Icon name="back" /></button>
          <button className="transport__play" type="button" onClick={togglePlayback} disabled={!track && useAppStore.getState().tracks.length === 0} aria-label={isPlaying ? '暂停' : '播放'}>
            <Icon name={isPlaying ? 'pause' : 'play'} />
          </button>
          <button type="button" onClick={nextTrack} disabled={!track} aria-label="下一首"><Icon name="forward" /></button>
        </div>
        <div className="timeline">
          <span>{formatTime(currentTime)}</span>
          <input
            type="range"
            min="0"
            max={Math.max(safeDuration, 1)}
            step="0.05"
            value={Math.min(currentTime, Math.max(safeDuration, 1))}
            onChange={(event) => audioEngine.seek(Number(event.target.value))}
            disabled={!track}
            style={{ '--range-progress': `${safeDuration ? (currentTime / safeDuration) * 100 : 0}%` } as React.CSSProperties}
            aria-label="播放进度"
          />
          <span>{formatTime(safeDuration)}</span>
        </div>
      </div>

      <div className="volume-control">
        <Icon name="volume" />
        <input
          type="range"
          min="0"
          max="1"
          step="0.01"
          value={volume}
          onChange={(event) => setVolume(Number(event.target.value))}
          style={{ '--range-progress': `${volume * 100}%` } as React.CSSProperties}
          aria-label="音量"
        />
        <span>{Math.round(volume * 100)}</span>
      </div>
    </footer>
  );
}
