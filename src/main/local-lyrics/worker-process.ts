import { spawn } from 'node:child_process';
import type { LocalLyricsWorkerRequest, WorkerProgressMessage, WorkerResultMessage } from './worker-protocol.js';
import { JsonLinesDecoder, parseWorkerMessage, WorkerProtocolError } from './worker-protocol.js';

export class WorkerExecutionError extends Error {
  constructor(
    readonly kind: 'not_configured' | 'start' | 'protocol' | 'worker' | 'cancelled' | 'timeout',
    message: string,
  ) {
    super(message);
    this.name = 'WorkerExecutionError';
  }
}

export interface WorkerRunOptions {
  executable: string;
  scriptPath: string;
  request: LocalLyricsWorkerRequest;
  signal?: AbortSignal;
  timeoutMs?: number;
  onProgress?: (message: WorkerProgressMessage) => void;
  onLog?: (level: 'debug' | 'info' | 'warning', message: string) => void;
}

export type WorkerProcessRunner = (options: WorkerRunOptions) => Promise<WorkerResultMessage>;

const MAX_STDERR_BYTES = 1024 * 1024;

export function createWorkerEnvironment(
  environment: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  return {
    ...environment,
    PYTHONUTF8: '1',
    PYTHONIOENCODING: 'utf-8',
  };
}

export const runWorkerProcess: WorkerProcessRunner = (options) => new Promise((resolve, reject) => {
  if (options.signal?.aborted) {
    reject(new WorkerExecutionError('cancelled', '本地歌词任务已取消'));
    return;
  }

  const child = spawn(options.executable, [options.scriptPath], {
    env: createWorkerEnvironment(),
    shell: false,
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const decoder = new JsonLinesDecoder();
  let stderr = '';
  let result: WorkerResultMessage | undefined;
  let workerError: WorkerExecutionError | undefined;
  let settled = false;

  const finish = (error?: Error): void => {
    if (settled) return;
    settled = true;
    clearTimeout(timeout);
    options.signal?.removeEventListener('abort', abort);
    if (error) reject(error);
    else if (result) resolve(result);
    else reject(new WorkerExecutionError('protocol', 'Worker 正常退出但没有返回结果'));
  };

  const acceptLine = (line: string): void => {
    let message;
    try {
      message = parseWorkerMessage(line, options.request.taskId);
    } catch (error) {
      workerError = new WorkerExecutionError(
        'protocol',
        error instanceof Error ? error.message : 'Worker 协议解析失败',
      );
      child.kill();
      return;
    }
    if (message.type === 'progress') options.onProgress?.(message);
    else if (message.type === 'log') options.onLog?.(message.level, message.message);
    else if (message.type === 'error') {
      workerError = new WorkerExecutionError('worker', message.message);
      child.kill();
    } else {
      result = message;
    }
  };

  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => {
    try {
      for (const line of decoder.push(chunk)) acceptLine(line);
    } catch (error) {
      workerError = new WorkerExecutionError(
        'protocol',
        error instanceof WorkerProtocolError ? error.message : 'Worker 输出读取失败',
      );
      child.kill();
    }
  });
  child.stderr.on('data', (chunk: string) => {
    if (Buffer.byteLength(stderr, 'utf8') < MAX_STDERR_BYTES) stderr += chunk;
  });

  const abort = (): void => {
    workerError = new WorkerExecutionError('cancelled', '本地歌词任务已取消');
    child.kill();
  };
  options.signal?.addEventListener('abort', abort, { once: true });

  const timeout = setTimeout(() => {
    workerError = new WorkerExecutionError('timeout', '本地 AI Worker 执行超时');
    child.kill();
  }, options.timeoutMs ?? 2 * 60 * 60 * 1000);

  child.once('error', (error: NodeJS.ErrnoException) => {
    finish(new WorkerExecutionError(
      error.code === 'ENOENT' ? 'not_configured' : 'start',
      error.code === 'ENOENT'
        ? `无法启动 Python 环境：${options.executable}`
        : `无法启动本地 AI Worker：${error.message}`,
    ));
  });
  child.once('close', (code) => {
    try {
      for (const line of decoder.finish()) acceptLine(line);
    } catch (error) {
      workerError ??= new WorkerExecutionError(
        'protocol',
        error instanceof Error ? error.message : 'Worker 输出读取失败',
      );
    }
    if (workerError) finish(workerError);
    else if (code !== 0) {
      finish(new WorkerExecutionError(
        'worker',
        stderr.trim() || `Worker 退出码为 ${code ?? '未知'}`,
      ));
    } else finish();
  });

  child.stdin.end(`${JSON.stringify(options.request)}\n`, 'utf8');
});
