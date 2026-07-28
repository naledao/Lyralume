// @vitest-environment node

import { describe, expect, it } from 'vitest';
import type { BilingualLyricsTask, LocalLyricsTask } from '../shared/contracts';
import {
  bilingualTaskCompletionNotification,
  localTaskCompletionNotification,
} from './task-notification-events';

const localTask: LocalLyricsTask = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  trackId: '111111111111111111111111',
  status: 'review',
  stage: 'draft',
  progress: 1,
  message: '草稿已生成',
  draftLines: [{
    id: 'line-1',
    startTime: 1,
    endTime: 2,
    text: 'line',
    confidence: 1,
    flags: [],
  }],
  draftOffsetMs: 0,
  lowConfidenceCount: 0,
  lrcSaveStatus: 'not_started',
  tagWriteStatus: 'not_started',
  createdAt: 1,
  updatedAt: 2,
};

const bilingualTask: BilingualLyricsTask = {
  id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  trackId: '222222222222222222222222',
  status: 'review',
  progress: 1,
  message: '中文双语草稿已生成',
  targetLanguage: 'zh-CN',
  style: 'lyrical',
  lines: [{ id: 'line-1', time: 1, originalText: 'line', translatedText: '歌词' }],
  sources: [],
  tagWriteStatus: 'not_started',
  createdAt: 1,
  updatedAt: 2,
};

describe('task completion notification events', () => {
  it('labels generated drafts as waiting for human review', () => {
    expect(localTaskCompletionNotification(localTask, 'Song')).toMatchObject({
      key: `local:${localTask.id}:review`,
      title: '歌词草稿已生成',
      body: expect.stringContaining('等待你校对'),
      target: { kind: 'local', trackId: localTask.trackId },
    });
    expect(bilingualTaskCompletionNotification(bilingualTask, 'Song')).toMatchObject({
      key: `bilingual:${bilingualTask.id}:review`,
      title: '中文双语草稿已生成',
      body: expect.stringContaining('等待你审阅'),
      target: { kind: 'bilingual', trackId: bilingualTask.trackId },
    });
  });

  it('uses a distinct completion event after verified tag writing', () => {
    expect(bilingualTaskCompletionNotification({
      ...bilingualTask,
      tagWriteStatus: 'verified',
    }, 'Song')).toMatchObject({
      key: `bilingual:${bilingualTask.id}:tag-verified`,
      title: '双语歌词写入完成',
    });
  });

  it('does not notify for in-progress work', () => {
    expect(localTaskCompletionNotification({
      ...localTask,
      status: 'transcribing',
      progress: 0.4,
      draftLines: [],
    }, 'Song')).toBeNull();
  });

  it('does not emit a completion notification for a manual status override', () => {
    expect(bilingualTaskCompletionNotification({
      ...bilingualTask,
      statusOverride: 'resolved',
    }, 'Song')).toBeNull();
  });
});
