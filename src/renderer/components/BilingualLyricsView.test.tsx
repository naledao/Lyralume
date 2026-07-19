import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { BilingualLyricsTask, Track } from '../../shared/contracts';
import { BilingualLyricsView } from './BilingualLyricsView';

const track: Track = {
  id: '0123456789abcdef01234567',
  title: 'If We Have Each Other',
  artist: 'Alec Benjamin',
  album: 'Narrated For You',
  language: null,
  fileName: 'If We Have Each Other.mp3',
  duration: 184,
  fileSize: 8_000_000,
  modifiedAt: 1,
  hasLyrics: true,
  hasArtwork: false,
  playbackUrl: 'lyralume-media://track/0123456789abcdef01234567',
};

const task: BilingualLyricsTask = {
  id: 'f2f3ff7b-4a75-4dd0-9f07-5c5f61bd05e2',
  trackId: track.id,
  status: 'review',
  progress: 1,
  message: '中文双语草稿已生成，等待人工审阅',
  targetLanguage: 'zh-CN',
  style: 'lyrical',
  sourceRevision: 'a'.repeat(64),
  lines: [{
    id: '1.000-0',
    time: 1,
    originalText: 'I will hold your hand',
    translatedText: '我会牵着你的手',
  }],
  sources: [],
  tagWriteStatus: 'not_started',
  createdAt: 1,
  updatedAt: 2,
};

describe('BilingualLyricsView', () => {
  it('asks for confirmation before writing the reviewed draft to MP3', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const onWriteTag = vi.fn(async () => task);
    render(
      <BilingualLyricsView
        track={track}
        task={task}
        busy={false}
        currentTime={1}
        offsetMs={0}
        onStart={vi.fn()}
        onCancel={vi.fn()}
        onWriteTag={onWriteTag}
        onSeek={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '写入 MP3 歌词' }));

    expect(confirm).toHaveBeenCalledOnce();
    await waitFor(() => expect(onWriteTag).toHaveBeenCalledOnce());
    confirm.mockRestore();
  });
});
