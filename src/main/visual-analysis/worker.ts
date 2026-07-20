import { createHash } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import { StreamingAudioAnalyzer } from '../../shared/audio-dsp.js';
import type {
  VisualAnalysisWorkerCommand,
  VisualAnalysisWorkerMessage,
  VisualAnalysisWorkerRequest,
} from './protocol.js';

let activeProcess: ChildProcess | null = null;
let activeTaskId: string | null = null;

function send(message: VisualAnalysisWorkerMessage): void {
  process.parentPort?.postMessage(message);
}

function pcmChunk(buffer: Buffer): Float32Array {
  const samples = new Float32Array(Math.floor(buffer.length / 4));
  for (let index = 0; index < samples.length; index += 1) {
    samples[index] = buffer.readFloatLE(index * 4);
  }
  return samples;
}

export async function analyzeAudioFile(
  request: VisualAnalysisWorkerRequest,
  onProgress: (progress: number) => void = () => undefined,
): Promise<{ fingerprint: string; profile: ReturnType<StreamingAudioAnalyzer['finish']>['profile']; timeline: ReturnType<StreamingAudioAnalyzer['finish']>['timeline'] }> {
  const analyzer = new StreamingAudioAnalyzer(request.sampleRate);
  const fingerprint = createHash('sha256');
  let decodedSamples = 0;
  let remainder = Buffer.alloc(0);
  let stderr = '';
  let lastProgress = -1;

  const child = spawn(request.ffmpegPath, [
    '-hide_banner',
    '-loglevel',
    'error',
    '-nostdin',
    '-i',
    request.filePath,
    '-vn',
    '-sn',
    '-dn',
    '-ac',
    '1',
    '-ar',
    String(request.sampleRate),
    '-f',
    'f32le',
    'pipe:1',
  ], {
    windowsHide: true,
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  activeProcess = child;
  activeTaskId = request.taskId;

  child.stdout.on('data', (chunk: Buffer) => {
    fingerprint.update(chunk);
    const combined = remainder.length > 0 ? Buffer.concat([remainder, chunk]) : chunk;
    const alignedLength = combined.length - (combined.length % 4);
    if (alignedLength > 0) {
      const samples = pcmChunk(combined.subarray(0, alignedLength));
      analyzer.push(samples);
      decodedSamples += samples.length;
    }
    remainder = Buffer.from(combined.subarray(alignedLength));
    const decodedMs = (decodedSamples / request.sampleRate) * 1_000;
    const progress = request.durationMs > 0
      ? Math.min(0.99, decodedMs / request.durationMs)
      : 0;
    if (progress - lastProgress >= 0.01) {
      lastProgress = progress;
      onProgress(progress);
    }
  });
  child.stderr.on('data', (chunk: Buffer) => {
    if (stderr.length < 16_000) stderr += chunk.toString('utf8');
  });

  const exitCode = await new Promise<number>((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code) => resolve(code ?? -1));
  }).finally(() => {
    if (activeProcess === child) activeProcess = null;
    if (activeTaskId === request.taskId) activeTaskId = null;
  });
  if (exitCode !== 0) {
    throw new Error(stderr.trim() || `FFmpeg 分析失败（退出码 ${exitCode}）`);
  }
  if (decodedSamples === 0) throw new Error('FFmpeg 未输出可分析的音频数据');
  const durationMs = request.durationMs > 0
    ? request.durationMs
    : (decodedSamples / request.sampleRate) * 1_000;
  const result = analyzer.finish(durationMs);
  onProgress(1);
  return {
    fingerprint: fingerprint.digest('hex'),
    profile: result.profile,
    timeline: result.timeline,
  };
}

process.parentPort?.on('message', (event) => {
  const command = event.data as VisualAnalysisWorkerCommand;
  if (command.type === 'cancel') {
    if (activeTaskId === command.taskId) activeProcess?.kill();
    return;
  }
  if (command.type !== 'analyze' || activeTaskId) return;
  void analyzeAudioFile(command, (progress) => {
    send({ type: 'progress', taskId: command.taskId, progress });
  }).then((result) => {
    send({ type: 'result', taskId: command.taskId, ...result });
  }).catch((error) => {
    send({
      type: 'error',
      taskId: command.taskId,
      message: error instanceof Error ? error.message : '整曲分析失败',
    });
  });
});
