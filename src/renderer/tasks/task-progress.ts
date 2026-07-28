import type {
  BilingualLyricsTask,
  LocalLyricsTask,
  LyricsTaskKind,
  LyricsTaskStatusOverride,
  Track,
} from '../../shared/contracts';

export type TaskProgressPhase = 'running' | 'attention' | 'completed' | 'failed' | 'cancelled';

export interface TaskProgressItem {
  key: string;
  kind: LyricsTaskKind;
  taskId: string;
  track: Track;
  phase: TaskProgressPhase;
  statusLabel: string;
  typeLabel: string;
  message: string;
  progress: number;
  updatedAt: number;
  canCancel: boolean;
  canOverride: boolean;
  statusOverride: LyricsTaskStatusOverride | null;
}

const LOCAL_RUNNING = new Set<LocalLyricsTask['status']>([
  'queued',
  'separating',
  'transcribing',
  'compiling',
  'saving_draft',
  'saving_lrc',
  'writing_tag',
]);
const LOCAL_CANCELLABLE = new Set<LocalLyricsTask['status']>([
  'queued',
  'separating',
  'transcribing',
  'compiling',
]);
const BILINGUAL_RUNNING = new Set<BilingualLyricsTask['status']>([
  'analyzing',
  'researching',
  'translating',
]);

function localPhase(task: LocalLyricsTask): TaskProgressPhase {
  if (task.statusOverride === 'resolved') return 'completed';
  if (task.statusOverride === 'cancelled') return 'cancelled';
  if (LOCAL_RUNNING.has(task.status)) return 'running';
  if (task.status === 'review') return 'attention';
  if (task.status === 'failed') return 'failed';
  if (task.status === 'cancelled') return 'cancelled';
  return 'completed';
}

function bilingualPhase(task: BilingualLyricsTask): TaskProgressPhase {
  if (task.statusOverride === 'resolved') return 'completed';
  if (task.statusOverride === 'cancelled') return 'cancelled';
  if (BILINGUAL_RUNNING.has(task.status) || task.tagWriteStatus === 'writing') return 'running';
  if (task.status === 'failed') return 'failed';
  if (task.status === 'cancelled') return 'cancelled';
  if (task.status === 'review' && task.tagWriteStatus !== 'verified') return 'attention';
  return 'completed';
}

function localStatusLabel(task: LocalLyricsTask, phase: TaskProgressPhase): string {
  if (task.statusOverride === 'resolved') return '已处理';
  if (task.statusOverride === 'cancelled') return '已取消';
  if (phase === 'attention') return '待校对';
  if (phase === 'failed') return '失败';
  if (phase === 'cancelled') return '已取消';
  if (task.status === 'lrc_saved') return 'LRC 已保存';
  if (task.status === 'completed') return '已写入';
  if (task.status === 'writing_tag') return '正在写入';
  if (task.status === 'saving_lrc' || task.status === 'saving_draft') return '正在保存';
  return '运行中';
}

function bilingualStatusLabel(
  task: BilingualLyricsTask,
  phase: TaskProgressPhase,
): string {
  if (task.statusOverride === 'resolved') return '已处理';
  if (task.statusOverride === 'cancelled') return '已取消';
  if (task.tagWriteStatus === 'writing') return '正在写入';
  if (phase === 'attention') return '待审阅';
  if (phase === 'failed') return '失败';
  if (phase === 'cancelled') return '已取消';
  if (task.tagWriteStatus === 'verified') return '已写入';
  return '运行中';
}

export function buildTaskProgressItems(
  tracks: Track[],
  localTasks: Record<string, LocalLyricsTask>,
  bilingualTasks: Record<string, BilingualLyricsTask>,
): TaskProgressItem[] {
  const tracksById = new Map(tracks.map((track) => [track.id, track]));
  const localItems = Object.values(localTasks).flatMap((task): TaskProgressItem[] => {
    const track = tracksById.get(task.trackId);
    if (!track || task.status === 'idle') return [];
    const phase = localPhase(task);
    return [{
      key: `local:${task.id}`,
      kind: 'local',
      taskId: task.id,
      track,
      phase,
      statusLabel: localStatusLabel(task, phase),
      typeLabel: '本机 AI 歌词',
      message: task.message,
      progress: Math.min(1, Math.max(0, task.progress)),
      updatedAt: task.updatedAt,
      canCancel: LOCAL_CANCELLABLE.has(task.status),
      canOverride: !LOCAL_RUNNING.has(task.status),
      statusOverride: task.statusOverride ?? null,
    }];
  });
  const bilingualItems = Object.values(bilingualTasks).flatMap((task): TaskProgressItem[] => {
    const track = tracksById.get(task.trackId);
    if (!track || task.status === 'idle') return [];
    const phase = bilingualPhase(task);
    return [{
      key: `bilingual:${task.id}`,
      kind: 'bilingual',
      taskId: task.id,
      track,
      phase,
      statusLabel: bilingualStatusLabel(task, phase),
      typeLabel: 'Codex 中文译配',
      message: task.message,
      progress: Math.min(1, Math.max(0, task.progress)),
      updatedAt: task.updatedAt,
      canCancel: BILINGUAL_RUNNING.has(task.status),
      canOverride: !BILINGUAL_RUNNING.has(task.status) && task.tagWriteStatus !== 'writing',
      statusOverride: task.statusOverride ?? null,
    }];
  });
  const rank: Record<TaskProgressPhase, number> = {
    running: 0,
    attention: 1,
    failed: 2,
    completed: 3,
    cancelled: 4,
  };
  return [...localItems, ...bilingualItems].sort((left, right) => (
    rank[left.phase] - rank[right.phase]
    // Manually archived tasks should not hide genuine completion history merely
    // because changing their override refreshed updatedAt.
    || Number(left.statusOverride !== null) - Number(right.statusOverride !== null)
    || right.updatedAt - left.updatedAt
  ));
}

export function actionableTaskCount(items: TaskProgressItem[]): number {
  return items.filter((item) => (
    item.phase === 'running' || item.phase === 'attention' || item.phase === 'failed'
  )).length;
}
