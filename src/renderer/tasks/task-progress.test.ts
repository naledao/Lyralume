import { describe, expect, it } from 'vitest';
import type { BilingualLyricsTask, LocalLyricsTask, Track } from '../../shared/contracts';
import { actionableTaskCount, buildTaskProgressItems } from './task-progress';

const track: Track = {
  id: '111111111111111111111111',
  fileName: 'song.mp3',
  title: 'Song',
  artist: 'Artist',
  album: 'Album',
  language: null,
  duration: 180,
  fileSize: 1_000,
  modifiedAt: 1,
  hasLyrics: true,
  hasArtwork: false,
  playbackUrl: 'lyralume-media://track/111111111111111111111111',
};

function localTask(status: LocalLyricsTask['status']): LocalLyricsTask {
  return {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    trackId: track.id,
    status,
    stage: status === 'review' ? 'draft' : 'transcription',
    progress: status === 'review' ? 1 : 0.45,
    message: status === 'review' ? '草稿已生成' : '正在识别歌词',
    draftLines: status === 'review' ? [{
      id: 'line-1',
      startTime: 1,
      endTime: 2,
      text: 'line',
      confidence: 1,
      flags: [],
    }] : [],
    draftOffsetMs: 0,
    lowConfidenceCount: 0,
    lrcSaveStatus: 'not_started',
    tagWriteStatus: 'not_started',
    createdAt: 1,
    updatedAt: 2,
  };
}

function bilingualTask(tagWriteStatus: BilingualLyricsTask['tagWriteStatus']): BilingualLyricsTask {
  return {
    id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    trackId: track.id,
    status: 'review',
    progress: 1,
    message: tagWriteStatus === 'verified' ? '已写入并验证' : '等待审阅',
    targetLanguage: 'zh-CN',
    style: 'lyrical',
    lines: [{ id: 'line-1', time: 1, originalText: 'line', translatedText: '歌词' }],
    sources: [],
    tagWriteStatus,
    createdAt: 1,
    updatedAt: 3,
  };
}

describe('task progress model', () => {
  it('prioritizes running and review tasks and counts states that need attention', () => {
    const secondTrack = { ...track, id: '222222222222222222222222', title: 'Second' };
    const reviewing = { ...localTask('review'), trackId: secondTrack.id };
    const running = localTask('transcribing');
    const items = buildTaskProgressItems(
      [track, secondTrack],
      { [track.id]: running, [secondTrack.id]: reviewing },
      {},
    );

    expect(items.map((item) => item.phase)).toEqual(['running', 'attention']);
    expect(items[0]).toMatchObject({ statusLabel: '运行中', canCancel: true });
    expect(items[1]).toMatchObject({ statusLabel: '待校对', canCancel: false });
    expect(actionableTaskCount(items)).toBe(2);
  });

  it('treats a verified bilingual draft as completed instead of awaiting review', () => {
    const items = buildTaskProgressItems(
      [track],
      {},
      { [track.id]: bilingualTask('verified') },
    );

    expect(items).toEqual([
      expect.objectContaining({ phase: 'completed', statusLabel: '已写入' }),
    ]);
    expect(actionableTaskCount(items)).toBe(0);
  });

  it('uses a reversible manual status override without changing the task payload state', () => {
    const task = {
      ...bilingualTask('failed'),
      statusOverride: 'resolved' as const,
    };
    const items = buildTaskProgressItems([track], {}, { [track.id]: task });

    expect(task.status).toBe('review');
    expect(task.tagWriteStatus).toBe('failed');
    expect(items).toEqual([
      expect.objectContaining({
        phase: 'completed',
        statusLabel: '已处理',
        statusOverride: 'resolved',
        canOverride: true,
      }),
    ]);
    expect(actionableTaskCount(items)).toBe(0);
  });

  it('keeps genuine completion history ahead of recently archived manual overrides', () => {
    const completedTrack = { ...track, id: '222222222222222222222222', title: 'Completed' };
    const archivedTask = {
      ...bilingualTask('failed'),
      statusOverride: 'resolved' as const,
      updatedAt: 100,
    };
    const completedTask = {
      ...localTask('completed'),
      trackId: completedTrack.id,
      tagWriteStatus: 'verified' as const,
      updatedAt: 10,
    };

    const items = buildTaskProgressItems(
      [track, completedTrack],
      { [completedTrack.id]: completedTask },
      { [track.id]: archivedTask },
    );

    expect(items.map((item) => item.track.title)).toEqual(['Completed', 'Song']);
  });
});
