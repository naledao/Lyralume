import { useMemo } from 'react';
import { useAppStore } from '../store/useAppStore';
import {
  actionableTaskCount,
  buildTaskProgressItems,
  type TaskProgressItem,
} from '../tasks/task-progress';
import { Artwork } from './Artwork';
import { Icon } from './Icon';

const UPDATED_AT_FORMAT = new Intl.DateTimeFormat('zh-CN', {
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});

export function TaskProgressPage() {
  const tracks = useAppStore((state) => state.tracks);
  const localTasks = useAppStore((state) => state.localLyricsTasks);
  const bilingualTasks = useAppStore((state) => state.bilingualLyricsTasks);
  const loading = useAppStore((state) => state.lyricsTasksLoading);
  const error = useAppStore((state) => state.lyricsTasksError);
  const openTask = useAppStore((state) => state.openLyricsTask);
  const refresh = useAppStore((state) => state.loadLyricsTasks);
  const cancelLocal = useAppStore((state) => state.cancelLocalLyrics);
  const cancelBilingual = useAppStore((state) => state.cancelBilingualLyrics);
  const setStatusOverride = useAppStore((state) => state.setLyricsTaskStatusOverride);
  const items = useMemo(
    () => buildTaskProgressItems(tracks, localTasks, bilingualTasks),
    [bilingualTasks, localTasks, tracks],
  );
  const actionable = actionableTaskCount(items);

  const cancelTask = (item: TaskProgressItem): void => {
    if (item.kind === 'local') void cancelLocal(item.track.id);
    else void cancelBilingual(item.track.id);
  };

  return (
    <main className="task-progress-page">
      <header className="task-progress-page__heading">
        <div>
          <span className="eyebrow">BACKGROUND TASKS</span>
          <h2>任务进度</h2>
          <p>离开歌词面板不会中断任务；完成后会通过 Win11 系统通知提醒你。</p>
        </div>
        <div className="task-progress-page__summary">
          <span><strong>{items.filter((item) => item.phase === 'running').length}</strong> 运行中</span>
          <span><strong>{actionable}</strong> 待处理</span>
          <span><strong>{items.length}</strong> 全部任务</span>
          <button type="button" onClick={() => void refresh()} disabled={loading}>
            <Icon name="refresh" className={loading ? 'spin' : undefined} />
            刷新
          </button>
        </div>
      </header>

      {error && <div className="task-progress-page__error" role="alert">{error}</div>}
      <div className="task-progress-list" aria-live="polite">
        {loading && items.length === 0 ? (
          <div className="task-progress-empty">
            <i />
            <strong>正在读取任务记录…</strong>
          </div>
        ) : items.length === 0 ? (
          <div className="task-progress-empty">
            <div><Icon name="tasks" /></div>
            <strong>还没有歌词任务</strong>
            <p>本机生成歌词或使用 Codex 中文译配后，进度会集中显示在这里。</p>
          </div>
        ) : items.map((item) => (
          <article className="task-progress-card" data-phase={item.phase} key={item.key}>
            <Artwork track={item.track} className="task-progress-card__artwork" />
            <div className="task-progress-card__main">
              <div className="task-progress-card__identity">
                <span>{item.typeLabel}</span>
                <strong>{item.track.title}</strong>
                <small>{item.track.artist} · {item.track.album}</small>
              </div>
              <div className="task-progress-card__status">
                <span data-phase={item.phase}>{item.statusLabel}</span>
                <time dateTime={new Date(item.updatedAt).toISOString()}>
                  {UPDATED_AT_FORMAT.format(item.updatedAt)}
                </time>
              </div>
              <p>{item.message}</p>
              {item.phase === 'running' && (
                <div className="task-progress-card__progress">
                  <div><i style={{ width: `${Math.round(item.progress * 100)}%` }} /></div>
                  <strong>{Math.round(item.progress * 100)}%</strong>
                </div>
              )}
              <div className="task-progress-card__actions">
                <select
                  aria-label={`强制设置《${item.track.title}》的任务状态`}
                  title={item.canOverride ? '强制改变任务状态' : '运行中的任务请先取消'}
                  value={item.statusOverride ?? ''}
                  disabled={!item.canOverride}
                  onChange={(event) => {
                    const value = event.currentTarget.value;
                    void setStatusOverride(
                      item.kind,
                      item.track.id,
                      value === 'resolved' || value === 'cancelled' ? value : null,
                    );
                  }}
                >
                  <option value="">自动状态</option>
                  <option value="resolved">标记已处理</option>
                  <option value="cancelled">标记已取消</option>
                </select>
                {item.canCancel && (
                  <button type="button" onClick={() => cancelTask(item)}>取消任务</button>
                )}
                <button
                  type="button"
                  className="task-progress-card__open"
                  onClick={() => openTask(item.kind, item.track.id)}
                >
                  {item.phase === 'attention' ? '去校对' : '查看详情'}
                </button>
              </div>
            </div>
          </article>
        ))}
      </div>
    </main>
  );
}
