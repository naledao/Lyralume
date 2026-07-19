import type { SeparationWorkerRequest, TranscriptionWorkerRequest, WorkerProgressMessage, WorkerResultMessage } from './worker-protocol.js';
import { runWorkerProcess, type WorkerProcessRunner } from './worker-process.js';

export interface LocalLyricsWorkerGateway {
  separate(
    request: SeparationWorkerRequest,
    signal: AbortSignal,
    onProgress: (message: WorkerProgressMessage) => void,
  ): Promise<WorkerResultMessage>;
  transcribe(
    request: TranscriptionWorkerRequest,
    signal: AbortSignal,
    onProgress: (message: WorkerProgressMessage) => void,
  ): Promise<WorkerResultMessage>;
}

export class PythonWorkerGateway implements LocalLyricsWorkerGateway {
  constructor(
    private readonly uvrPython: string,
    private readonly whisperPython: string,
    private readonly uvrScript: string,
    private readonly whisperScript: string,
    private readonly runner: WorkerProcessRunner = runWorkerProcess,
    private readonly onLog: (taskId: string, level: string, message: string) => void = () => undefined,
  ) {}

  separate(
    request: SeparationWorkerRequest,
    signal: AbortSignal,
    onProgress: (message: WorkerProgressMessage) => void,
  ): Promise<WorkerResultMessage> {
    return this.runner({
      executable: this.uvrPython,
      scriptPath: this.uvrScript,
      request,
      signal,
      onProgress,
      onLog: (level, message) => this.onLog(request.taskId, level, message),
    });
  }

  transcribe(
    request: TranscriptionWorkerRequest,
    signal: AbortSignal,
    onProgress: (message: WorkerProgressMessage) => void,
  ): Promise<WorkerResultMessage> {
    return this.runner({
      executable: this.whisperPython,
      scriptPath: this.whisperScript,
      request,
      signal,
      onProgress,
      onLog: (level, message) => this.onLog(request.taskId, level, message),
    });
  }
}
