import { useEffect, useMemo, useState } from 'react';
import { AudioController } from './audio/AudioController';
import { Artwork } from './components/Artwork';
import { Icon } from './components/Icon';
import { LibrarySidebar } from './components/LibrarySidebar';
import { LyricsPanel } from './components/LyricsPanel';
import { PlayerControls } from './components/PlayerControls';
import { TrackList } from './components/TrackList';
import { currentTrackFromState, useAppStore } from './store/useAppStore';
import { AudioVisualizer } from './visuals/AudioVisualizer';

export function App() {
  const [query, setQuery] = useState('');
  const [version, setVersion] = useState('');
  const tracks = useAppStore((state) => state.tracks);
  const roots = useAppStore((state) => state.roots);
  const libraryLoading = useAppStore((state) => state.libraryLoading);
  const message = useAppStore((state) => state.libraryMessage);
  const track = useAppStore(currentTrackFromState);
  const initialize = useAppStore((state) => state.initialize);
  const applySnapshot = useAppStore((state) => state.applySnapshot);
  const setScanProgress = useAppStore((state) => state.setScanProgress);
  const chooseDirectory = useAppStore((state) => state.chooseDirectory);

  useEffect(() => {
    void initialize();
    void window.lyralume.app.getVersion().then(setVersion);
    const offChanged = window.lyralume.library.onChanged(applySnapshot);
    const offProgress = window.lyralume.library.onScanProgress(setScanProgress);
    return () => {
      offChanged();
      offProgress();
    };
  }, [applySnapshot, initialize, setScanProgress]);

  const filteredTracks = useMemo(() => {
    const term = query.trim().toLocaleLowerCase();
    if (!term) return tracks;
    return tracks.filter((item) =>
      [item.title, item.artist, item.album, item.fileName].some((value) => value.toLocaleLowerCase().includes(term)),
    );
  }, [query, tracks]);

  return (
    <div className="app-shell">
      <AudioController />
      <header className="titlebar">
        <span>Lyralume</span>
        {version && <small>v{version}</small>}
      </header>

      <div className="app-main">
        <LibrarySidebar />
        <main className="content">
          <section className="now-playing">
            <AudioVisualizer />
            <div className="now-playing__identity">
              <Artwork track={track} className="now-playing__artwork" />
              <div>
                <span className="eyebrow">{track ? 'NOW PLAYING' : 'LOCAL · ORIGINAL · YOURS'}</span>
                <h1>{track?.title ?? '让本地音乐亮起来'}</h1>
                <p>{track ? `${track.artist} · ${track.album}` : '导入音乐文件夹，播放原始文件，并让歌词和光影一起流动。'}</p>
              </div>
            </div>
          </section>

          <section className="library-view">
            <div className="library-view__heading">
              <div>
                <span className="eyebrow">LIBRARY</span>
                <h2>本地音乐</h2>
                <small>{tracks.length} 首歌曲 · {roots.length} 个文件夹</small>
              </div>
              <label className="search-box">
                <Icon name="search" />
                <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索歌曲、艺术家或专辑" />
              </label>
            </div>

            {message && <div className="library-message" role="status">{message}</div>}
            {libraryLoading ? (
              <div className="library-loading"><i /><span>正在载入音乐库…</span></div>
            ) : tracks.length === 0 ? (
              <div className="welcome-state">
                <div className="welcome-state__orb"><Icon name="music" /></div>
                <h2>从你的音乐文件夹开始</h2>
                <p>歌曲只在本机扫描和播放。Lyralume 不会修改或重新编码原始音频。</p>
                <button className="button button--primary" type="button" onClick={() => void chooseDirectory()}>
                  <Icon name="add" />选择音乐文件夹
                </button>
              </div>
            ) : <TrackList tracks={filteredTracks} />}
          </section>
        </main>
        <LyricsPanel />
      </div>
      <PlayerControls />
    </div>
  );
}
