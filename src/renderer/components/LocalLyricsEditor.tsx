import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  LocalLyricsDraftLine,
  LocalLyricsDraftUpdate,
  LocalLyricsModelSettings,
  LocalLyricsProofreadProgress,
  LocalLyricsProofreadResult,
  LocalLyricsStartOptions,
  LocalLyricsTask,
  Track,
} from '../../shared/contracts';
import { formatTime } from '../lib/format';
import { mergeDraftLineWithPrevious, splitDraftLine, updateDraftLineTime } from '../lyrics/draft-editing';
import { Icon } from './Icon';

const RUNNING_STATUSES = new Set<LocalLyricsTask['status']>([
  'queued',
  'separating',
  'transcribing',
  'compiling',
]);

function formatWorkflowElapsed(elapsedMs: number): string {
  const seconds = Math.max(0, elapsedMs) / 1_000;
  return seconds < 10 ? `${seconds.toFixed(1)}s` : `${Math.round(seconds)}s`;
}

export function LocalLyricsEditor({
  track,
  task,
  busy,
  proofreadBusy,
  proofreadError,
  proofreadProgress,
  modelSettings,
  modelSettingsBusy,
  modelSettingsError,
  onChooseUvrModel,
  onResetUvrModel,
  onStart,
  onCancel,
  onProofread,
  onSaveDraft,
  onConfirmLrc,
  onWriteTag,
}: {
  track: Track;
  task: LocalLyricsTask | null;
  busy: boolean;
  proofreadBusy: boolean;
  proofreadError: string | null;
  proofreadProgress: LocalLyricsProofreadProgress[];
  modelSettings: LocalLyricsModelSettings | null;
  modelSettingsBusy: boolean;
  modelSettingsError: string | null;
  onChooseUvrModel: () => void;
  onResetUvrModel: () => void;
  onStart: (options: LocalLyricsStartOptions) => void;
  onCancel: () => void;
  onProofread: (
    update: LocalLyricsDraftUpdate,
  ) => Promise<LocalLyricsProofreadResult | null>;
  onSaveDraft: (update: LocalLyricsDraftUpdate) => Promise<LocalLyricsTask | null>;
  onConfirmLrc: (
    update: LocalLyricsDraftUpdate,
    overwriteExisting?: boolean,
  ) => Promise<LocalLyricsTask | null>;
  onWriteTag: (update: LocalLyricsDraftUpdate) => Promise<LocalLyricsTask | null>;
}) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [lines, setLines] = useState<LocalLyricsDraftLine[]>(task?.draftLines ?? []);
  const [offsetMs, setOffsetMs] = useState(task?.draftOffsetMs ?? 0);
  const [selectedLineId, setSelectedLineId] = useState<string | null>(null);
  const [loopLine, setLoopLine] = useState(false);
  const [previewSource, setPreviewSource] = useState<'original' | 'vocals'>('original');
  const [preCodexDraft, setPreCodexDraft] = useState<LocalLyricsDraftUpdate | null>(null);
  const [codexNotice, setCodexNotice] = useState<string | null>(null);
  const [codexSources, setCodexSources] = useState<LocalLyricsProofreadResult['sources']>([]);

  useEffect(() => {
    setLines(task?.draftLines ?? []);
    setOffsetMs(task?.draftOffsetMs ?? 0);
    setSelectedLineId(task?.draftLines[0]?.id ?? null);
    setPreCodexDraft(null);
    setCodexNotice(null);
    setCodexSources([]);
  }, [task?.id, task?.status === 'review' ? task.updatedAt : task?.id]);

  const update = useMemo<LocalLyricsDraftUpdate>(() => ({ lines, offsetMs }), [lines, offsetMs]);
  const selectedLine = lines.find((line) => line.id === selectedLineId);
  const previewUrl = previewSource === 'vocals' ? task?.vocalsPlaybackUrl : track.playbackUrl;

  const releasePreview = (): void => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.pause();
    audio.removeAttribute('src');
    audio.load();
  };

  const handleTimeUpdate = (): void => {
    const audio = audioRef.current;
    if (!audio || !loopLine || !selectedLine) return;
    const start = Math.max(0, selectedLine.startTime + offsetMs / 1000);
    const end = Math.max(start + 0.1, selectedLine.endTime + offsetMs / 1000);
    if (audio.currentTime >= end || audio.currentTime < start - 0.1) {
      audio.currentTime = start;
      void audio.play();
    }
  };

  const playLine = (line: LocalLyricsDraftLine): void => {
    setSelectedLineId(line.id);
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = Math.max(0, line.startTime + offsetMs / 1000);
    void audio.play();
  };

  const runCodexProofread = async (): Promise<void> => {
    const before = lines.map((line) => ({ ...line, flags: [...line.flags] }));
    const beforeOffsetMs = offsetMs;
    const result = await onProofread(update);
    if (!result) return;
    setPreCodexDraft({ lines: before, offsetMs: beforeOffsetMs });
    setLines(result.lines);
    setOffsetMs(result.offsetMs);
    setSelectedLineId(result.lines[0]?.id ?? null);
    setCodexSources(result.sources);
    const structure = before.length === result.lines.length
      ? `${result.lines.length} 行`
      : `${before.length} 行调整为 ${result.lines.length} 行`;
    const offsetChanged = beforeOffsetMs === result.offsetMs
      ? ''
      : `，整体偏移调整为 ${(result.offsetMs / 1000).toFixed(1)}s`;
    setCodexNotice(`Codex 已更新 ${result.changedLineCount} 行（${structure}${offsetChanged}）。${result.summary}`);
  };

  if (!task || task.status === 'idle' || (task.draftLines.length === 0 && !RUNNING_STATUSES.has(task.status))) {
    return (
      <div className="local-task-state">
        <div className="lyrics-state__icon"><Icon name="sparkles" /></div>
        <strong>在本机生成歌词草稿</strong>
        <p>先分离临时人声，再由 WhisperX 转写和对齐。原始音乐不会被修改，结果必须校对后才能保存。</p>
        {task?.error && <div className="online-error" role="alert">{task.error.message}</div>}
        <section className="local-model-settings" aria-label="UVR 模型设置">
          <div className="local-model-settings__heading">
            <strong>UVR 人声分离模型</strong>
            <span data-source={modelSettings?.uvrModelSource ?? 'loading'}>
              {modelSettings?.uvrModelSource === 'custom' ? '自定义文件' : '默认托管'}
            </span>
          </div>
          <code title={modelSettings?.uvrModelPath}>
            {modelSettings?.uvrModelPath ?? '正在读取模型设置…'}
          </code>
          <p>
            {modelSettings?.uvrModelSource === 'custom'
              ? modelSettings.uvrModelAvailable
                ? '将直接使用这个本地文件，不会下载、删除或覆盖它。'
                : '这个自定义文件已不存在，请重新选择。'
              : modelSettings?.uvrModelAvailable
                ? '默认模型已下载，可直接使用。'
                : '默认模型尚未下载；你可以自行下载后选择模型文件。'}
          </p>
          {modelSettingsError && <div className="online-error" role="alert">{modelSettingsError}</div>}
          <div className="local-model-settings__actions">
            <button type="button" disabled={busy || modelSettingsBusy} onClick={onChooseUvrModel}>
              {modelSettingsBusy ? '正在处理…' : '选择本地模型文件'}
            </button>
            <button
              type="button"
              disabled={busy || modelSettingsBusy || modelSettings?.uvrModelSource !== 'custom'}
              onClick={onResetUvrModel}
            >恢复默认自动下载</button>
          </div>
        </section>
        <div className="local-task-state__actions">
          <button type="button" disabled={busy || modelSettingsBusy} onClick={() => onStart({ device: 'cuda' })}>使用 NVIDIA CUDA</button>
          <button type="button" disabled={busy || modelSettingsBusy} onClick={() => onStart({ device: 'cpu' })}>使用 CPU 回退</button>
        </div>
      </div>
    );
  }

  if (RUNNING_STATUSES.has(task.status)) {
    return (
      <div className="local-task-state">
        <div className="lyrics-state__icon lyrics-state__icon--loading"><Icon name="sparkles" /></div>
        <strong>{task.message}</strong>
        <p>GPU 阶段串行执行；UVR 退出并释放资源后才会启动 WhisperX。</p>
        <div className="local-progress" aria-label="本地歌词生成进度">
          <i style={{ width: `${Math.round(task.progress * 100)}%` }} />
        </div>
        <small>{Math.round(task.progress * 100)}%</small>
        <button className="online-action online-action--secondary" type="button" disabled={busy} onClick={onCancel}>取消并保留结果</button>
      </div>
    );
  }

  return (
    <div className="local-editor">
      <div className="local-editor__summary">
        <div>
          <strong>校对歌词草稿</strong>
          <span>{lines.length} 行 · {lines.filter((line) => line.flags.length > 0).length} 行需留意</span>
        </div>
        <div className="local-editor__summary-tools">
          <div className="local-editor__preview-switch">
            <button type="button" data-active={previewSource === 'original'} onClick={() => setPreviewSource('original')}>原曲</button>
            <button type="button" data-active={previewSource === 'vocals'} disabled={!task.vocalsPlaybackUrl} onClick={() => setPreviewSource('vocals')}>临时人声</button>
          </div>
          <div className="local-editor__regenerate" aria-label="重新生成本机歌词">
            <button
              type="button"
              disabled={busy || proofreadBusy || modelSettingsBusy}
              onClick={() => onStart({ device: 'cuda' })}
            >CUDA 重生成</button>
            <button
              type="button"
              disabled={busy || proofreadBusy || modelSettingsBusy}
              onClick={() => onStart({ device: 'cpu' })}
            >CPU 重生成</button>
          </div>
        </div>
      </div>
      <section className="local-editor__codex" aria-label="Codex 歌词校对">
        <div>
          <strong>Codex 联网校对</strong>
          <span>可调整文字、时间轴、整体偏移和行结构；结果不会自动保存，可完整撤销。</span>
        </div>
        <button
          type="button"
          disabled={busy || proofreadBusy}
          onClick={() => void runCodexProofread()}
        >{proofreadBusy ? 'Codex 正在校对…' : '使用 Codex 校对'}</button>
        {proofreadError && <div className="online-error" role="alert">{proofreadError}</div>}
        {proofreadProgress.length > 0 && (
          <div className="local-editor__codex-workflow" role="log" aria-live="polite">
            <div className="local-editor__codex-workflow-heading">
              <strong>Codex 工作流程</strong>
              <span data-state={proofreadProgress.at(-1)?.stage ?? 'preparing'}>
                {proofreadBusy
                  ? '进行中'
                  : proofreadProgress.at(-1)?.stage === 'completed'
                    ? '已完成'
                    : proofreadProgress.at(-1)?.stage === 'failed'
                      ? '失败'
                      : '已停止'}
              </span>
            </div>
            <ol>
              {proofreadProgress.map((progress, index) => (
                <li
                  data-current={index === proofreadProgress.length - 1}
                  data-stage={progress.stage}
                  key={`${progress.timestamp}-${index}`}
                >
                  <i aria-hidden="true" />
                  <div>
                    <strong>{progress.message}</strong>
                    {progress.detail && <span>{progress.detail}</span>}
                  </div>
                  <time>{formatWorkflowElapsed(progress.elapsedMs)}</time>
                </li>
              ))}
            </ol>
            <small>显示 CLI、联网检索和校验事件摘要；不展示模型隐藏推理。</small>
          </div>
        )}
        {codexNotice && <div className="local-editor__codex-result" role="status">{codexNotice}</div>}
        {codexSources.length > 0 && (
          <div className="local-editor__codex-sources">
            <strong>本次联网来源</strong>
            {codexSources.map((source) => (
              <a href={source.url} key={source.url} target="_blank" rel="noreferrer">
                {source.title}
              </a>
            ))}
          </div>
        )}
        {preCodexDraft && (
          <button
            className="local-editor__codex-undo"
            type="button"
            disabled={busy || proofreadBusy}
            onClick={() => {
              setLines(preCodexDraft.lines);
              setOffsetMs(preCodexDraft.offsetMs);
              setSelectedLineId(preCodexDraft.lines[0]?.id ?? null);
              setPreCodexDraft(null);
              setCodexSources([]);
              setCodexNotice('已撤销本次 Codex 修改。');
            }}
          >撤销 Codex 修改</button>
        )}
      </section>
      {task.error && <div className="online-error" role="alert">{task.error.message}</div>}
      {(task.lrcSaveStatus === 'saved' || task.tagWriteStatus === 'verified') && (
        <div className="local-success" role="status">{task.message}</div>
      )}
      <audio
        className="local-editor__audio"
        controls
        key={previewUrl}
        onTimeUpdate={handleTimeUpdate}
        ref={audioRef}
        src={previewUrl}
      />
      <label className="local-editor__loop">
        <input type="checkbox" checked={loopLine} onChange={(event) => setLoopLine(event.target.checked)} />
        循环当前行
      </label>
      <div className="local-editor__offset">
        <span>整体偏移 <strong>{offsetMs > 0 ? '+' : ''}{(offsetMs / 1000).toFixed(1)}s</strong></span>
        <button type="button" disabled={proofreadBusy} onClick={() => setOffsetMs((value) => value - 500)}>-0.5s</button>
        <button type="button" disabled={proofreadBusy} onClick={() => setOffsetMs(0)}>重置</button>
        <button type="button" disabled={proofreadBusy} onClick={() => setOffsetMs((value) => value + 500)}>+0.5s</button>
      </div>
      <div className="local-editor__lines">
        {lines.map((line, index) => (
          <article
            className={line.flags.length > 0 ? 'draft-line draft-line--warning' : 'draft-line'}
            data-selected={selectedLineId === line.id}
            key={line.id}
          >
            <button className="draft-line__play" type="button" onClick={() => playLine(line)} aria-label={`试听第 ${index + 1} 行`}>
              {formatTime(line.startTime)}
            </button>
            <input
              className="draft-line__time"
              aria-label={`第 ${index + 1} 行开始时间`}
              type="number"
              min="0"
              step="0.01"
              disabled={proofreadBusy}
              value={line.startTime.toFixed(2)}
              onChange={(event) => setLines((current) => current.map((item) => (
                item.id === line.id ? updateDraftLineTime(item, Number(event.target.value)) : item
              )))}
            />
            <textarea
              aria-label={`第 ${index + 1} 行歌词`}
              rows={2}
              disabled={proofreadBusy}
              value={line.text}
              onChange={(event) => setLines((current) => current.map((item) => (
                item.id === line.id ? { ...item, text: event.target.value, tokens: undefined } : item
              )))}
            />
            <div className="draft-line__meta">
              <span>{line.confidence === null ? '无置信度' : `置信度 ${Math.round(line.confidence * 100)}%`}</span>
              {line.flags.includes('missing_timing') && <em>需校时</em>}
              {line.flags.includes('low_confidence') && <em>低置信度</em>}
            </div>
            <div className="draft-line__actions">
              <button type="button" disabled={proofreadBusy || index === 0} onClick={() => setLines((current) => mergeDraftLineWithPrevious(current, line.id))}>与上行合并</button>
              <button type="button" disabled={proofreadBusy} onClick={() => setLines((current) => splitDraftLine(current, line.id))}>拆行</button>
            </div>
          </article>
        ))}
      </div>
      <div className="local-editor__actions">
        <button type="button" disabled={busy || proofreadBusy} onClick={() => void onSaveDraft(update)}>保存草稿</button>
        <button
          type="button"
          disabled={busy || proofreadBusy}
          onClick={() => {
            if (window.confirm('确认已完成校对，并将正式 LRC 保存到歌曲旁边？')) {
              void onConfirmLrc(update);
            }
          }}
        >保存正式 LRC</button>
        {task.error?.code === 'existing_lrc' && (
          <button
            className="local-editor__danger"
            type="button"
            disabled={busy || proofreadBusy}
            onClick={() => {
              if (window.confirm('歌曲旁已有同名 LRC。确认用当前校对结果覆盖它？')) {
                void onConfirmLrc(update, true);
              }
            }}
          >确认覆盖已有 LRC</button>
        )}
        <button
          type="button"
          disabled={busy || proofreadBusy}
          onClick={() => {
            if (!window.confirm('确认已完成校对，并将同步歌词写入原音频标签？')) return;
            releasePreview();
            void onWriteTag(update);
          }}
        >写入并回读验证标签</button>
      </div>
    </div>
  );
}
