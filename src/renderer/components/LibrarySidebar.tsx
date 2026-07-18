import { Icon } from './Icon';
import { useAppStore } from '../store/useAppStore';

export function LibrarySidebar() {
  const roots = useAppStore((state) => state.roots);
  const tracks = useAppStore((state) => state.tracks);
  const scanning = useAppStore((state) => state.scanning);
  const scanProgress = useAppStore((state) => state.scanProgress);
  const chooseDirectory = useAppStore((state) => state.chooseDirectory);
  const rescan = useAppStore((state) => state.rescan);

  const progress = scanProgress && scanProgress.total > 0
    ? Math.round((scanProgress.processed / scanProgress.total) * 100)
    : 0;

  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand__mark"><span /></div>
        <div>
          <strong>Lyralume</strong>
          <small>LOCAL PLAYER</small>
        </div>
      </div>

      <nav className="sidebar__nav" aria-label="主导航">
        <div className="nav-item nav-item--active">
          <Icon name="album" />
          <span>音乐库</span>
          <em>{tracks.length}</em>
        </div>
        <div className="nav-item nav-item--muted">
          <Icon name="lyrics" />
          <span>本地歌词</span>
          <em>{tracks.filter((track) => track.hasLyrics).length}</em>
        </div>
      </nav>

      <div className="sidebar__section-heading">
        <span>音乐文件夹</span>
        <button type="button" onClick={() => void chooseDirectory()} aria-label="添加音乐文件夹" disabled={scanning}>
          <Icon name="add" />
        </button>
      </div>

      <div className="root-list">
        {roots.length === 0 ? (
          <p className="root-list__empty">还没有导入文件夹</p>
        ) : roots.map((root) => (
          <div className="root-item" key={root.path} title={root.path}>
            <span className="root-item__dot" />
            <span>{root.path.split(/[\\/]/).filter(Boolean).pop()}</span>
          </div>
        ))}
      </div>

      <div className="sidebar__actions">
        {scanning && (
          <div className="scan-state" aria-live="polite">
            <div><span>正在扫描</span><strong>{progress}%</strong></div>
            <div className="scan-state__track"><i style={{ width: `${progress}%` }} /></div>
            <small>{scanProgress?.currentFile ?? '整理音乐库…'}</small>
          </div>
        )}
        <button className="button button--primary" type="button" onClick={() => void chooseDirectory()} disabled={scanning}>
          <Icon name="add" />
          选择音乐文件夹
        </button>
        <button className="button button--ghost" type="button" onClick={() => void rescan()} disabled={scanning || roots.length === 0}>
          <Icon name="refresh" className={scanning ? 'spin' : ''} />
          重新扫描
        </button>
      </div>
    </aside>
  );
}
