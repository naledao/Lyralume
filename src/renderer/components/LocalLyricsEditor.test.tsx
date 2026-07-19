import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LocalLyricsModelSettings, LocalLyricsTask, Track } from '../../shared/contracts';
import { LocalLyricsEditor } from './LocalLyricsEditor';

const track: Track = {
  id: '777777777777777777777777',
  title: 'Local Song',
  artist: 'Artist',
  album: 'Album',
  fileName: 'Local Song.flac',
  duration: 60,
  fileSize: 100,
  modifiedAt: 1,
  hasLyrics: false,
  hasArtwork: false,
  playbackUrl: 'lyralume-media://track/777777777777777777777777',
};

const task: LocalLyricsTask = {
  id: '62fa754e-65f0-4148-b68b-22278102ef18',
  trackId: track.id,
  status: 'review',
  stage: 'draft',
  progress: 1,
  message: '请校对',
  draftLines: [{
    id: 'line-1',
    startTime: 1,
    endTime: 2,
    text: '原始草稿',
    confidence: 0.4,
    flags: ['low_confidence'],
  }],
  draftOffsetMs: 0,
  lowConfidenceCount: 1,
  vocalsPlaybackUrl: 'lyralume-media://task-vocals/62fa754e-65f0-4148-b68b-22278102ef18',
  lrcSaveStatus: 'not_started',
  tagWriteStatus: 'not_started',
  createdAt: 1,
  updatedAt: 1,
};

const modelSettings: LocalLyricsModelSettings = {
  uvrModelSource: 'managed',
  uvrModelPath: String.raw`C:\models\uvr\model_bs_roformer_ep_317_sdr_12.9755.ckpt`,
  uvrModelName: 'model_bs_roformer_ep_317_sdr_12.9755.ckpt',
  uvrModelAvailable: false,
};

function handlers() {
  return {
    onStart: vi.fn(),
    modelSettings,
    modelSettingsBusy: false,
    modelSettingsError: null,
    onChooseUvrModel: vi.fn(),
    onResetUvrModel: vi.fn(),
    onCancel: vi.fn(),
    proofreadBusy: false,
    proofreadError: null,
    proofreadProgress: [],
    onProofread: vi.fn(async () => ({
      lines: [
        { ...task.draftLines[0], id: 'codex-1', endTime: 1.5, text: 'Codex' },
        { ...task.draftLines[0], id: 'codex-2', startTime: 1.5, text: '校对歌词' },
      ],
      offsetMs: 500,
      changedLineCount: 3,
      summary: '拆为两行并调整偏移',
      sources: [{ title: '公开歌词资料', url: 'https://example.com/lyrics' }],
    })),
    onSaveDraft: vi.fn(async () => task),
    onConfirmLrc: vi.fn(async () => task),
    onWriteTag: vi.fn(async () => task),
  };
}

afterEach(cleanup);

describe('LocalLyricsEditor', () => {
  it('offers isolated CUDA and CPU task starts before a draft exists', () => {
    const callbacks = handlers();
    render(<LocalLyricsEditor track={track} task={null} busy={false} {...callbacks} />);
    fireEvent.click(screen.getByRole('button', { name: '使用 NVIDIA CUDA' }));
    fireEvent.click(screen.getByRole('button', { name: '使用 CPU 回退' }));
    expect(callbacks.onStart).toHaveBeenNthCalledWith(1, { device: 'cuda' });
    expect(callbacks.onStart).toHaveBeenNthCalledWith(2, { device: 'cpu' });
  });

  it('lets the user choose a downloaded UVR model and restore managed downloads', () => {
    const callbacks = handlers();
    const custom = {
      ...modelSettings,
      uvrModelSource: 'custom' as const,
      uvrModelPath: String.raw`D:\AI\uvr-model.ckpt`,
      uvrModelName: 'uvr-model.ckpt',
      uvrModelAvailable: true,
    };
    render(
      <LocalLyricsEditor
        track={track}
        task={null}
        busy={false}
        {...callbacks}
        modelSettings={custom}
      />,
    );
    expect(screen.getByText(String.raw`D:\AI\uvr-model.ckpt`)).toBeInTheDocument();
    expect(screen.getByText('将直接使用这个本地文件，不会下载、删除或覆盖它。')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '选择本地模型文件' }));
    fireEvent.click(screen.getByRole('button', { name: '恢复默认自动下载' }));
    expect(callbacks.onChooseUvrModel).toHaveBeenCalledOnce();
    expect(callbacks.onResetUvrModel).toHaveBeenCalledOnce();
  });

  it('shows low confidence and saves edited text only as a draft', async () => {
    const callbacks = handlers();
    render(<LocalLyricsEditor track={track} task={task} busy={false} {...callbacks} />);
    expect(screen.getByText('低置信度')).toBeInTheDocument();
    fireEvent.change(screen.getByRole('textbox', { name: '第 1 行歌词' }), {
      target: { value: '人工校对歌词' },
    });
    fireEvent.click(screen.getByRole('button', { name: '保存草稿' }));
    await waitFor(() => expect(callbacks.onSaveDraft).toHaveBeenCalledWith({
      offsetMs: 0,
      lines: [expect.objectContaining({ text: '人工校对歌词' })],
    }));
    expect(callbacks.onConfirmLrc).not.toHaveBeenCalled();
    expect(callbacks.onWriteTag).not.toHaveBeenCalled();
  });

  it('applies Codex structure and timing suggestions without saving and supports full undo', async () => {
    const callbacks = handlers();
    render(<LocalLyricsEditor track={track} task={task} busy={false} {...callbacks} />);

    fireEvent.click(screen.getByRole('button', { name: '使用 Codex 校对' }));

    await waitFor(() => expect(callbacks.onProofread).toHaveBeenCalledWith({
      offsetMs: 0,
      lines: task.draftLines,
    }));
    expect(screen.getByRole('textbox', { name: '第 1 行歌词' })).toHaveValue('Codex');
    expect(screen.getByRole('textbox', { name: '第 2 行歌词' })).toHaveValue('校对歌词');
    expect(screen.getByText(/1 行调整为 2 行，整体偏移调整为 0.5s/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '公开歌词资料' })).toHaveAttribute(
      'href',
      'https://example.com/lyrics',
    );
    expect(callbacks.onSaveDraft).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: '撤销 Codex 修改' }));
    expect(screen.getByRole('textbox', { name: '第 1 行歌词' })).toHaveValue('原始草稿');
    expect(screen.queryByRole('textbox', { name: '第 2 行歌词' })).not.toBeInTheDocument();
    expect(screen.getByText('0.0s')).toBeInTheDocument();
  });

  it('shows the real Codex CLI workflow and web-search query', () => {
    const callbacks = handlers();
    render(
      <LocalLyricsEditor
        track={track}
        task={task}
        busy={false}
        {...callbacks}
        proofreadBusy
        proofreadProgress={[
          {
            trackId: track.id,
            stage: 'connected',
            message: 'Codex CLI 会话已建立',
            elapsedMs: 120,
            timestamp: 100,
          },
          {
            trackId: track.id,
            stage: 'searching',
            message: '联网检索完成',
            detail: '爱说 咖啡因乐队 REAL 歌词',
            elapsedMs: 2_400,
            timestamp: 200,
          },
        ]}
      />,
    );

    expect(screen.getByRole('log')).toHaveTextContent('Codex 工作流程');
    expect(screen.getByRole('log')).toHaveTextContent('Codex CLI 会话已建立');
    expect(screen.getByRole('log')).toHaveTextContent('爱说 咖啡因乐队 REAL 歌词');
    expect(screen.getByRole('log')).toHaveTextContent('2.4s');
  });
});
