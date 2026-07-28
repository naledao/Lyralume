import { useEffect, useMemo, useState } from 'react';
import type { MusicDownloadTask, MusicSearchItem } from '../../shared/contracts';
import { Icon } from './Icon';

function durationLabel(duration: number): string {
  if (!Number.isFinite(duration) || duration <= 0) return '--:--';
  const seconds = Math.round(duration);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

function bytesLabel(bytes?: number): string {
  if (!bytes || bytes <= 0) return '';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

function taskLabel(task: MusicDownloadTask): string {
  if (task.status === 'queued') return '等待下载';
  if (task.status === 'postprocessing') return '正在转为 320 kbps MP3';
  if (task.status === 'completed') return task.outputFileName ? `已保存 · ${task.outputFileName}` : '已保存';
  if (task.status === 'cancelled') return '已取消';
  if (task.status === 'failed') return task.error || '下载失败';
  const downloaded = bytesLabel(task.downloadedBytes);
  const total = bytesLabel(task.totalBytes);
  const speed = bytesLabel(task.speedBytesPerSecond);
  return [downloaded && total ? `${downloaded} / ${total}` : downloaded, speed ? `${speed}/s` : '', task.etaSeconds ? `剩余 ${Math.ceil(task.etaSeconds)} 秒` : '']
    .filter(Boolean)
    .join(' · ') || '正在下载';
}

export function OnlineMusicPage() {
  const [keyword, setKeyword] = useState('');
  const [results, setResults] = useState<MusicSearchItem[]>([]);
  const [tasks, setTasks] = useState<MusicDownloadTask[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void window.lyralume.music.getTasks().then(setTasks).catch(() => undefined);
    return window.lyralume.music.onTaskChanged((changed) => {
      setTasks((current) => {
        const next = current.filter((task) => task.id !== changed.id);
        return [changed, ...next].sort((left, right) => right.createdAt - left.createdAt);
      });
    });
  }, []);

  const latestTaskByMusicId = useMemo(() => {
    const latest = new Map<string, MusicDownloadTask>();
    for (const task of tasks) if (!latest.has(task.musicId)) latest.set(task.musicId, task);
    return latest;
  }, [tasks]);

  const search = async (): Promise<void> => {
    const normalized = keyword.trim();
    if (!normalized || searching) return;
    setSearching(true);
    setError(null);
    try {
      setResults((await window.lyralume.music.search(normalized, 30)).results);
    } catch (searchError) {
      setError(searchError instanceof Error ? searchError.message : '音乐搜索失败');
    } finally {
      setSearching(false);
    }
  };

  const download = async (item: MusicSearchItem): Promise<void> => {
    setError(null);
    try {
      const task = await window.lyralume.music.startDownload({
        musicId: item.id,
        title: item.title,
        channel: item.channel,
        ...(item.cover ? { cover: item.cover } : {}),
      });
      setTasks((current) => [task, ...current.filter((entry) => entry.id !== task.id)]);
    } catch (downloadError) {
      setError(downloadError instanceof Error ? downloadError.message : '下载任务创建失败');
    }
  };

  return (
    <main className="online-music-page">
      <header className="online-music-page__heading">
        <div>
          <span className="eyebrow">LOCAL DOWNLOAD</span>
          <h2>搜索与下载</h2>
          <p>在本机搜索 YouTube 音乐并导出 320 kbps MP3；文件不会自动加入音乐库。</p>
        </div>
        <button type="button" onClick={() => void window.lyralume.music.openDownloadDirectory()}>
          <Icon name="folder" />打开下载目录
        </button>
      </header>

      <form
        className="online-music-search"
        onSubmit={(event) => {
          event.preventDefault();
          void search();
        }}
      >
        <Icon name="search" />
        <input
          value={keyword}
          onChange={(event) => setKeyword(event.currentTarget.value)}
          placeholder="输入歌曲名、歌手或关键词"
          maxLength={200}
          autoFocus
        />
        <button type="submit" disabled={searching || !keyword.trim()}>
          {searching ? '搜索中…' : '搜索'}
        </button>
      </form>

      {error && <div className="online-music-page__error" role="alert">{error}</div>}
      <div className="online-music-results" aria-live="polite">
        {searching && results.length === 0 ? (
          <div className="online-music-empty"><i /><strong>正在搜索音乐…</strong></div>
        ) : results.length === 0 ? (
          <div className="online-music-empty">
            <div><Icon name="search" /></div>
            <strong>搜索想下载的歌曲</strong>
            <p>代理和 Cookie 可在设置中配置，下载结果只保存到指定目录。</p>
          </div>
        ) : results.map((item) => {
          const latestTask = latestTaskByMusicId.get(item.id);
          const task = latestTask?.status === 'completed' ? undefined : latestTask;
          const active = task?.status === 'queued' || task?.status === 'running' || task?.status === 'postprocessing';
          return (
            <article className="online-music-card" key={item.id}>
              <div className="online-music-card__cover">
                {item.cover ? <img src={item.cover} alt="" loading="lazy" /> : <Icon name="music" />}
              </div>
              <div className="online-music-card__identity">
                <strong>{item.title}</strong>
                <small>{item.channel} · {durationLabel(item.duration)}</small>
                {task && <p data-status={task.status}>{taskLabel(task)}</p>}
                {active && (
                  <div className="online-music-card__progress">
                    <i style={{ width: `${Math.round(task.progress * 100)}%` }} />
                  </div>
                )}
              </div>
              <div className="online-music-card__actions">
                {active ? (
                  <button type="button" onClick={() => void window.lyralume.music.cancelDownload(task.id)}>取消</button>
                ) : (
                  <button
                    type="button"
                    onClick={() => void download(item)}
                  >
                    <Icon name="download" />
                    {task?.status === 'failed' || task?.status === 'cancelled' ? '重新下载' : '下载 MP3'}
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
