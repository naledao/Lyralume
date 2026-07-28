import type {
  BilingualLyricsTask,
  LocalLyricsTask,
  LyricsTaskTarget,
} from '../shared/contracts.js';

export interface TaskCompletionNotification {
  key: string;
  target: LyricsTaskTarget;
  title: string;
  body: string;
}

export function localTaskCompletionNotification(
  task: LocalLyricsTask,
  trackTitle: string,
): TaskCompletionNotification | null {
  if (task.statusOverride) return null;
  const target: LyricsTaskTarget = { kind: 'local', trackId: task.trackId };
  if (task.status === 'completed' && task.tagWriteStatus === 'verified') {
    return {
      key: `local:${task.id}:tag-verified`,
      target,
      title: '歌词写入完成',
      body: `《${trackTitle}》的同步歌词已写入音频并通过回读验证。`,
    };
  }
  if (task.status === 'lrc_saved' && task.lrcSaveStatus === 'saved') {
    return {
      key: `local:${task.id}:lrc-saved`,
      target,
      title: '同步歌词已保存',
      body: `《${trackTitle}》的正式 LRC 已安全保存。`,
    };
  }
  if (task.status === 'review' && task.draftLines.length > 0) {
    return {
      key: `local:${task.id}:review`,
      target,
      title: '歌词草稿已生成',
      body: `《${trackTitle}》的本机 AI 歌词草稿已就绪，等待你校对。`,
    };
  }
  return null;
}

export function bilingualTaskCompletionNotification(
  task: BilingualLyricsTask,
  trackTitle: string,
): TaskCompletionNotification | null {
  if (task.statusOverride) return null;
  const target: LyricsTaskTarget = { kind: 'bilingual', trackId: task.trackId };
  if (task.tagWriteStatus === 'verified') {
    return {
      key: `bilingual:${task.id}:tag-verified`,
      target,
      title: '双语歌词写入完成',
      body: `《${trackTitle}》的双语同步歌词已写入音频并通过回读验证。`,
    };
  }
  if (task.status === 'review' && task.lines.length > 0) {
    return {
      key: `bilingual:${task.id}:review`,
      target,
      title: '中文双语草稿已生成',
      body: `《${trackTitle}》的 Codex 双语草稿已就绪，等待你审阅。`,
    };
  }
  return null;
}
