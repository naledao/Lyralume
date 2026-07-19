import { useEffect, useMemo, useState } from 'react';
import type {
  BilingualLyricsStartOptions,
  BilingualLyricsTask,
  BilingualLyricsTranslationStyle,
  Track,
} from '../../shared/contracts';
import { findActiveLyricIndex } from '../../shared/lrc';
import { Icon } from './Icon';

const ACTIVE_STATUSES = new Set<BilingualLyricsTask['status']>([
  'analyzing',
  'researching',
  'translating',
]);

const STYLE_LABELS: Record<BilingualLyricsTranslationStyle, string> = {
  natural: '自然准确',
  lyrical: '意境优先',
  singable: '精炼顺口',
};

export function BilingualLyricsView({
  track,
  task,
  busy,
  currentTime,
  offsetMs,
  onStart,
  onCancel,
  onWriteTag,
  onSeek,
}: {
  track: Track;
  task: BilingualLyricsTask | null;
  busy: boolean;
  currentTime: number;
  offsetMs: number;
  onStart: (options: BilingualLyricsStartOptions) => void;
  onCancel: () => void;
  onWriteTag: () => Promise<BilingualLyricsTask | null>;
  onSeek: (time: number) => void;
}) {
  const [style, setStyle] = useState<BilingualLyricsTranslationStyle>(task?.style ?? 'lyrical');
  useEffect(() => {
    if (task?.style) setStyle(task.style);
  }, [task?.id, task?.style]);
  const activeIndex = useMemo(() => findActiveLyricIndex(
    task?.lines.map((line) => ({ id: line.id, time: line.time, text: line.originalText })) ?? [],
    currentTime,
    offsetMs,
  ), [currentTime, offsetMs, task?.lines]);
  const active = task && ACTIVE_STATUSES.has(task.status);

  if (active) {
    return (
      <div className="bilingual-task-state">
        <div className="lyrics-state__icon lyrics-state__icon--loading"><Icon name="sparkles" /></div>
        <strong>{task.message}</strong>
        <p>
          {task.status === 'researching'
            ? '联网阶段只接收歌曲名、艺术家和专辑；逐行歌词不会发送给网页。'
            : 'Codex 正在只读处理歌词，MP3、LRC 和标签都不会被修改。'}
        </p>
        <div className="local-progress" aria-label="Codex 双语译配进度">
          <i style={{ width: `${Math.round(task.progress * 100)}%` }} />
        </div>
        <small>{Math.round(task.progress * 100)}%</small>
        <button type="button" className="online-action online-action--secondary" onClick={onCancel}>
          取消译配
        </button>
      </div>
    );
  }

  if (task?.status === 'review') {
    return (
      <div className="bilingual-review">
        <section className="bilingual-review__summary">
          <div>
            <span>CODEX DRAFT · {STYLE_LABELS[task.style]}</span>
            <strong>中文双语草稿待审阅</strong>
          </div>
          <p>{task.summary ?? '已结合原歌词语境与公开背景资料完成逐行译配。'}</p>
          <small>
            {task.tagWriteStatus === 'verified'
              ? '双语草稿仍保存在本机，MP3 内的同步歌词已经回读确认。'
              : '草稿已保存在本机任务记录中，尚未写入 LRC 或原音频。'}
          </small>
        </section>
        {task.error && <div className="online-error" role="alert">{task.error.message}</div>}
        {task.tagWriteStatus === 'verified' && (
          <div className="local-success" role="status">{task.message}</div>
        )}
        <div className="bilingual-review__lines">
          {task.lines.map((line, index) => (
            <button
              type="button"
              className="bilingual-line"
              data-active={index === activeIndex}
              key={line.id}
              onClick={() => onSeek(line.time + offsetMs / 1_000)}
            >
              <span lang="und">{line.originalText || '· · ·'}</span>
              <strong lang="zh-CN">{line.translatedText || '· · ·'}</strong>
            </button>
          ))}
        </div>
        {task.sources.length > 0 && (
          <section className="bilingual-review__sources">
            <strong>本次语境研究来源</strong>
            {task.sources.map((source, index) => (
              <a href={source.url} key={`${source.url}-${index}`} target="_blank" rel="noreferrer">
                {source.title}
              </a>
            ))}
          </section>
        )}
        <div className="bilingual-review__regenerate">
          <label>
            <span>重新生成风格</span>
            <select value={style} onChange={(event) => setStyle(event.target.value as BilingualLyricsTranslationStyle)}>
              {Object.entries(STYLE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </label>
          <button type="button" disabled={busy} onClick={() => onStart({ style })}>重新生成草稿</button>
          <button
            type="button"
            className="bilingual-review__write-tag"
            disabled={busy || task.tagWriteStatus === 'verified'}
            onClick={() => {
              if (!window.confirm('确认已完成审阅，并将双语同步歌词直接写入 MP3 的 ID3 SYLT 标签？')) return;
              void onWriteTag();
            }}
          >
            {task.tagWriteStatus === 'writing'
              ? '正在写入 MP3…'
              : task.tagWriteStatus === 'verified' ? '已写入并验证' : '写入 MP3 歌词'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="bilingual-task-state">
      <div className="lyrics-state__icon"><Icon name="sparkles" /></div>
      <strong>让 Codex 生成中文双语草稿</strong>
      <p>
        先理解《{track.title}》的语境，再联网查找创作背景和可靠乐评，最后回到禁网阶段逐行译配，不做机械直译。
      </p>
      {task?.error && <div className="online-error" role="alert">{task.error.message}</div>}
      <label className="bilingual-style-picker">
        <span>中文表达风格</span>
        <select value={style} onChange={(event) => setStyle(event.target.value as BilingualLyricsTranslationStyle)}>
          {Object.entries(STYLE_LABELS).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
      </label>
      <div className="bilingual-task-state__privacy">
        <span>歌词仅发送给 Codex 模型</span>
        <span>联网研究不接收逐行歌词</span>
        <span>结果只保存为本机草稿</span>
      </div>
      <button type="button" disabled={busy} onClick={() => onStart({ style })}>
        {busy ? '正在启动 Codex…' : task?.status === 'failed' || task?.status === 'cancelled' ? '重新开始译配' : '开始双语译配'}
      </button>
    </div>
  );
}
