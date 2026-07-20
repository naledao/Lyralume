import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { utilityProcess, type UtilityProcess } from 'electron';
import type { TrackAudioProfile, TrackVisualTimeline } from '../../shared/visual-analysis.js';
import type {
  VisualAnalysisWorkerMessage,
  VisualAnalysisWorkerRequest,
} from './protocol.js';

export interface VisualAnalysisRunRequest {
  trackId: string;
  filePath: string;
  durationMs: number;
}

export interface VisualAnalysisRunResult {
  fingerprint: string;
  profile: TrackAudioProfile;
  timeline: TrackVisualTimeline;
}

export interface VisualAnalysisRunner {
  analyze(
    request: VisualAnalysisRunRequest,
    onProgress: (progress: number) => void,
  ): Promise<VisualAnalysisRunResult>;
  close(): Promise<void>;
}

export class UtilityVisualAnalysisRunner implements VisualAnalysisRunner {
  private readonly processes = new Map<UtilityProcess, string>();

  constructor(
    private readonly workerPath: string,
    private readonly ffmpegPath = process.env.LYRALUME_FFMPEG_PATH || 'ffmpeg',
  ) {}

  analyze(
    request: VisualAnalysisRunRequest,
    onProgress: (progress: number) => void,
  ): Promise<VisualAnalysisRunResult> {
    const taskId = `visual-${randomUUID()}`;
    const worker = utilityProcess.fork(path.resolve(this.workerPath), [], {
      serviceName: 'Lyralume Audio Analysis',
      stdio: 'pipe',
    });
    this.processes.set(worker, taskId);
    return new Promise<VisualAnalysisRunResult>((resolve, reject) => {
      let settled = false;
      const durationLimit = Math.max(120_000, request.durationMs * 2 + 60_000);
      const timeout = setTimeout(() => {
        finish(new Error('整曲分析超时'));
      }, durationLimit);
      const finish = (error?: Error, result?: VisualAnalysisRunResult): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        this.processes.delete(worker);
        worker.removeAllListeners();
        if (error) {
          try {
            worker.postMessage({ type: 'cancel', taskId });
          } catch {
            // The utility process may already have exited.
          }
          setTimeout(() => {
            if (worker.pid !== undefined) worker.kill();
          }, 250);
          reject(error);
        } else if (result) {
          if (worker.pid !== undefined) worker.kill();
          resolve(result);
        } else {
          if (worker.pid !== undefined) worker.kill();
          reject(new Error('整曲分析未返回结果'));
        }
      };
      worker.on('spawn', () => {
        const command: VisualAnalysisWorkerRequest = {
          type: 'analyze',
          taskId,
          trackId: request.trackId,
          filePath: request.filePath,
          durationMs: request.durationMs,
          sampleRate: 44_100,
          ffmpegPath: this.ffmpegPath,
        };
        worker.postMessage(command);
      });
      worker.on('message', (message: VisualAnalysisWorkerMessage) => {
        if (message.taskId !== taskId) return;
        if (message.type === 'progress') onProgress(message.progress);
        if (message.type === 'error') finish(new Error(message.message));
        if (message.type === 'result') finish(undefined, message);
      });
      worker.on('error', (_type, location) => finish(new Error(`分析进程错误：${location}`)));
      worker.on('exit', (code) => {
        if (!settled) finish(new Error(`分析进程意外退出（${code}）`));
      });
      worker.stderr?.on('data', () => undefined);
      worker.stdout?.on('data', () => undefined);
    });
  }

  async close(): Promise<void> {
    for (const [worker, taskId] of this.processes) {
      try {
        worker.postMessage({ type: 'cancel', taskId });
      } catch {
        // Continue shutting down the remaining workers.
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
    for (const worker of this.processes.keys()) worker.kill();
    this.processes.clear();
  }
}
