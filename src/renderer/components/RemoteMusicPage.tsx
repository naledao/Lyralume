import { useEffect, useMemo, useState } from 'react';
import type { RemoteMusicItem, RemoteMusicSnapshot, RemoteSyncStatus } from '../../shared/contracts';
import { formatFileSize, formatTime } from '../lib/format';
import { useAppStore } from '../store/useAppStore';
import { Icon } from './Icon';

const STATUS_LABELS: Record<RemoteSyncStatus, string> = {
  local_only: '仅本地',
  pending: '等待同步',
  hashing: '正在校验',
  uploading: '正在上传',
  synced: '已同步',
  local_changed: '本地有更新',
  remote_only: '仅远程',
  failed: '同步失败',
};

function remoteTime(value: number): string {
  if (!value) return '尚未上传';
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(value);
}

export function RemoteMusicPage() {
  const [snapshot, setSnapshot] = useState<RemoteMusicSnapshot | null>(null);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<RemoteSyncStatus | 'all'>('all');
  const [busy, setBusy] = useState<string | null>('loading');
  const [error, setError] = useState<string | null>(null);
  const setActiveView = useAppStore((state) => state.setActiveView);

  useEffect(() => {
    void window.lyralume.remote.getSnapshot()
      .then(setSnapshot)
      .catch((loadError) => setError(loadError instanceof Error ? loadError.message : '远程音乐列表读取失败'))
      .finally(() => setBusy(null));
    return window.lyralume.remote.onChanged(setSnapshot);
  }, []);

  const items = useMemo(() => {
    const term = query.trim().toLocaleLowerCase();
    return (snapshot?.items ?? []).filter((item) => (
      (filter === 'all' || item.syncStatus === filter)
      && (!term || [item.title, item.artist, item.album, item.fileName, item.objectName]
        .some((value) => value.toLocaleLowerCase().includes(term)))
    ));
  }, [filter, query, snapshot?.items]);

  const run = async (
    name: string,
    operation: () => Promise<RemoteMusicSnapshot>,
  ): Promise<void> => {
    setBusy(name);
    setError(null);
    try {
      setSnapshot(await operation());
    } catch (operationError) {
      setError(operationError instanceof Error ? operationError.message : '远程同步操作失败');
    } finally {
      setBusy(null);
    }
  };

  const syncItem = (item: RemoteMusicItem): void => {
    if (!item.localTrackId) return;
    void run(`sync:${item.localTrackId}`, () => window.lyralume.remote.syncTrack(item.localTrackId!));
  };

  if (snapshot && !snapshot.configured) {
    return (
      <main className="remote-music-page">
        <header className="remote-music-page__heading">
          <div><span className="eyebrow">REMOTE LIBRARY</span><h2>远程音乐</h2><p>查看并管理同步到 MinIO 的音乐。</p></div>
        </header>
        <div className="remote-music-empty">
          <div><Icon name="cloud" /></div>
          <strong>尚未配置 MinIO</strong>
          <p>先填写 API 地址、Bucket 和专用访问凭据，再启用自动同步。</p>
          <button type="button" onClick={() => setActiveView('settings')}>前往设置</button>
        </div>
      </main>
    );
  }

  return (
    <main className="remote-music-page">
      <header className="remote-music-page__heading">
        <div>
          <span className="eyebrow">REMOTE LIBRARY</span>
          <h2>远程音乐</h2>
          <p>
            <span className="remote-online-state" data-online={snapshot?.online === true}>
              {snapshot?.online ? 'MinIO 在线' : 'MinIO 离线'}
            </span>
            {' · '}{snapshot?.autoSync ? '自动同步已开启' : '手动同步'}
            {snapshot?.refreshedAt ? ` · 更新于 ${remoteTime(snapshot.refreshedAt)}` : ''}
          </p>
        </div>
        <div className="remote-heading-actions">
          <button
            type="button"
            disabled={Boolean(busy)}
            onClick={() => void run('refresh', window.lyralume.remote.refresh)}
          ><Icon name="refresh" />刷新远程列表</button>
          <button
            type="button"
            disabled={Boolean(busy)}
            onClick={() => void run('sync-all', window.lyralume.remote.syncAll)}
          ><Icon name="cloud" />同步全部</button>
        </div>
      </header>

      <div className="remote-music-toolbar">
        <label className="remote-music-search">
          <Icon name="search" />
          <input
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
            placeholder="搜索远程歌曲、艺术家或专辑"
          />
        </label>
        <select
          aria-label="同步状态筛选"
          value={filter}
          onChange={(event) => setFilter(event.currentTarget.value as RemoteSyncStatus | 'all')}
        >
          <option value="all">全部状态</option>
          {Object.entries(STATUS_LABELS).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
      </div>

      {(error || snapshot?.error) && (
        <div className="remote-music-page__error" role="alert">{error ?? snapshot?.error}</div>
      )}

      <div className="remote-music-results" aria-live="polite">
        {!snapshot && busy === 'loading' ? (
          <div className="remote-music-empty"><i /><strong>正在读取远程音乐…</strong></div>
        ) : items.length === 0 ? (
          <div className="remote-music-empty">
            <div><Icon name="cloud" /></div>
            <strong>{query || filter !== 'all' ? '没有符合条件的歌曲' : '远程曲库为空'}</strong>
            <p>可以点击“同步全部”，或在设置中开启自动同步。</p>
          </div>
        ) : items.map((item) => {
          const active = item.syncStatus === 'hashing' || item.syncStatus === 'uploading';
          const actionable = Boolean(item.localTrackId) && !active && item.syncStatus !== 'synced';
          return (
            <article className="remote-music-card" key={`${item.syncId}:${item.objectName}`}>
              <div className="remote-music-card__icon"><Icon name={item.syncStatus === 'synced' ? 'album' : 'cloud'} /></div>
              <div className="remote-music-card__identity">
                <strong>{item.title}</strong>
                <small>{item.artist} · {item.album}</small>
                <p>{item.fileName} · {formatFileSize(item.fileSize)} · {formatTime(item.duration)}</p>
                {item.error && <em>{item.error}</em>}
                {active && <div className="remote-music-card__progress"><i style={{ width: `${Math.round(item.progress * 100)}%` }} /></div>}
              </div>
              <div className="remote-music-card__remote">
                <span data-status={item.syncStatus}>{STATUS_LABELS[item.syncStatus]}</span>
                <small>{remoteTime(item.lastModified)}</small>
              </div>
              <div className="remote-music-card__actions">
                {actionable && (
                  <button type="button" disabled={Boolean(busy)} onClick={() => syncItem(item)}>
                    <Icon name="cloud" />{item.syncStatus === 'failed' ? '重试' : '同步'}
                  </button>
                )}
              </div>
            </article>
          );
        })}
      </div>
    </main>
  );
}
