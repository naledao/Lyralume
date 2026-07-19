export const LOCAL_LYRICS_WORKER_PROTOCOL_VERSION = 1 as const;

export type WorkerStage = 'separation' | 'transcription' | 'alignment';

interface WorkerRequestBase {
  version: typeof LOCAL_LYRICS_WORKER_PROTOCOL_VERSION;
  type: 'request';
  taskId: string;
}

export interface SeparationWorkerRequest extends WorkerRequestBase {
  action: 'separate';
  inputPath: string;
  outputPath: string;
  modelDirectory: string;
  modelName: string;
  modelSource: 'managed' | 'external';
  device: 'cuda' | 'cpu';
}

export interface TranscriptionWorkerRequest extends WorkerRequestBase {
  action: 'transcribe';
  inputPath: string;
  transcriptPath: string;
  alignmentPath: string;
  modelDirectory: string;
  modelName: string;
  device: 'cuda' | 'cpu';
  computeType: 'float16' | 'int8';
  batchSize: number;
  language?: string;
}

export type LocalLyricsWorkerRequest = SeparationWorkerRequest | TranscriptionWorkerRequest;

export interface WorkerProgressMessage {
  version: typeof LOCAL_LYRICS_WORKER_PROTOCOL_VERSION;
  type: 'progress';
  taskId: string;
  stage: WorkerStage;
  progress: number;
  message: string;
}

export interface WorkerLogMessage {
  version: typeof LOCAL_LYRICS_WORKER_PROTOCOL_VERSION;
  type: 'log';
  taskId: string;
  stage: WorkerStage;
  level: 'debug' | 'info' | 'warning';
  message: string;
}

export interface WorkerResultMessage {
  version: typeof LOCAL_LYRICS_WORKER_PROTOCOL_VERSION;
  type: 'result';
  taskId: string;
  stage: WorkerStage;
  outputs: Record<string, string>;
  language?: string;
}

export interface WorkerErrorMessage {
  version: typeof LOCAL_LYRICS_WORKER_PROTOCOL_VERSION;
  type: 'error';
  taskId: string;
  stage: WorkerStage;
  code: string;
  message: string;
  retryable: boolean;
}

export type LocalLyricsWorkerMessage =
  | WorkerProgressMessage
  | WorkerLogMessage
  | WorkerResultMessage
  | WorkerErrorMessage;

export class WorkerProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WorkerProtocolError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 4_096) {
    throw new WorkerProtocolError(`Worker 消息的 ${field} 字段无效`);
  }
  return value;
}

export function parseWorkerMessage(raw: string, expectedTaskId: string): LocalLyricsWorkerMessage {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new WorkerProtocolError('Worker 输出了无效的 JSON Lines 消息');
  }
  if (!isRecord(value)) throw new WorkerProtocolError('Worker 消息必须是 JSON 对象');
  if (value.version !== LOCAL_LYRICS_WORKER_PROTOCOL_VERSION) {
    throw new WorkerProtocolError('Worker 协议版本不兼容');
  }
  if (value.taskId !== expectedTaskId) {
    throw new WorkerProtocolError('Worker 消息的任务 ID 与当前任务不一致');
  }
  if (!['separation', 'transcription', 'alignment'].includes(String(value.stage))) {
    throw new WorkerProtocolError('Worker 消息包含未知阶段');
  }
  const stage = value.stage as WorkerStage;
  const type = value.type;

  if (type === 'progress') {
    if (typeof value.progress !== 'number' || !Number.isFinite(value.progress)) {
      throw new WorkerProtocolError('Worker 进度必须是有限数字');
    }
    return {
      version: 1,
      type,
      taskId: expectedTaskId,
      stage,
      progress: Math.min(1, Math.max(0, value.progress)),
      message: requiredString(value.message, 'message'),
    };
  }
  if (type === 'log') {
    if (!['debug', 'info', 'warning'].includes(String(value.level))) {
      throw new WorkerProtocolError('Worker 日志级别无效');
    }
    return {
      version: 1,
      type,
      taskId: expectedTaskId,
      stage,
      level: value.level as WorkerLogMessage['level'],
      message: requiredString(value.message, 'message'),
    };
  }
  if (type === 'result') {
    if (!isRecord(value.outputs)) throw new WorkerProtocolError('Worker 结果缺少 outputs');
    const outputs: Record<string, string> = {};
    for (const [key, output] of Object.entries(value.outputs)) {
      if (typeof output !== 'string' || output.length === 0) {
        throw new WorkerProtocolError('Worker 结果包含无效输出路径');
      }
      outputs[key] = output;
    }
    return {
      version: 1,
      type,
      taskId: expectedTaskId,
      stage,
      outputs,
      language: typeof value.language === 'string' ? value.language : undefined,
    };
  }
  if (type === 'error') {
    return {
      version: 1,
      type,
      taskId: expectedTaskId,
      stage,
      code: requiredString(value.code, 'code'),
      message: requiredString(value.message, 'message'),
      retryable: value.retryable === true,
    };
  }
  throw new WorkerProtocolError('Worker 消息类型无效');
}

export class JsonLinesDecoder {
  private buffered = '';

  constructor(private readonly maxLineLength = 256 * 1024) {}

  push(chunk: string): string[] {
    this.buffered += chunk;
    if (this.buffered.length > this.maxLineLength && !this.buffered.includes('\n')) {
      throw new WorkerProtocolError('Worker 输出的单条消息过大');
    }
    const lines = this.buffered.split(/\r?\n/);
    this.buffered = lines.pop() ?? '';
    return lines.filter((line) => line.trim().length > 0);
  }

  finish(): string[] {
    const final = this.buffered.trim();
    this.buffered = '';
    if (!final) return [];
    if (final.length > this.maxLineLength) throw new WorkerProtocolError('Worker 输出的单条消息过大');
    return [final];
  }
}
