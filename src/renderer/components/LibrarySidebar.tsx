import { useMemo } from 'react';
import lyralumeIconUrl from '../../../assets/branding/lyralume-icon-256.png';
import { Icon } from './Icon';
import { useAppStore } from '../store/useAppStore';
import { actionableTaskCount, buildTaskProgressItems } from '../tasks/task-progress';

export function LibrarySidebar() {
  const tracks = useAppStore((state) => state.tracks);
  const activeView = useAppStore((state) => state.activeView);
  const localTasks = useAppStore((state) => state.localLyricsTasks);
  const bilingualTasks = useAppStore((state) => state.bilingualLyricsTasks);
  const setActiveView = useAppStore((state) => state.setActiveView);

  const taskCount = useMemo(() => actionableTaskCount(
    buildTaskProgressItems(tracks, localTasks, bilingualTasks),
  ), [bilingualTasks, localTasks, tracks]);

  return (
    <aside className="sidebar">
      <div className="brand">
        <img className="brand__mark" src={lyralumeIconUrl} alt="" aria-hidden="true" />
        <div>
          <strong>Lyralume</strong>
          <small>LOCAL PLAYER</small>
        </div>
      </div>

      <nav className="sidebar__nav" aria-label="主导航">
        <button
          className={`nav-item${activeView === 'library' ? ' nav-item--active' : ''}`}
          type="button"
          onClick={() => setActiveView('library')}
        >
          <Icon name="album" />
          <span>音乐库</span>
          <em>{tracks.length}</em>
        </button>
        <button
          className={`nav-item${activeView === 'remote' ? ' nav-item--active' : ''}`}
          type="button"
          onClick={() => setActiveView('remote')}
        >
          <Icon name="cloud" />
          <span>远程音乐</span>
          <em />
        </button>
        <button
          className={`nav-item${activeView === 'online' ? ' nav-item--active' : ''}`}
          type="button"
          onClick={() => setActiveView('online')}
        >
          <Icon name="download" />
          <span>搜索下载</span>
          <em />
        </button>
        <button
          className={`nav-item${activeView === 'tasks' ? ' nav-item--active' : ''}`}
          type="button"
          onClick={() => setActiveView('tasks')}
        >
          <Icon name="tasks" />
          <span>任务进度</span>
          <em data-alert={taskCount > 0}>{taskCount || ''}</em>
        </button>
        <button
          className={`nav-item${activeView === 'settings' ? ' nav-item--active' : ''}`}
          type="button"
          onClick={() => setActiveView('settings')}
        >
          <Icon name="settings" />
          <span>设置</span>
          <em />
        </button>
      </nav>
    </aside>
  );
}
