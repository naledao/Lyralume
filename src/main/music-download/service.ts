import { spawn, type ChildProcess } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type {
  MusicDownloadRequest,
  MusicDownloadTask,
  MusicRuntimeSnapshot,
  MusicSearchItem,
  MusicSearchResult,
} from '../../shared/contracts.js';
import { logger } from '../logging.js';
import type { AppSettingsService } from '../settings/app-settings.js';
import {
  musicRuntimeSnapshot,
  type MusicDownloadRuntime,
} from './runtime.js';

const YOUTUBE_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;
const TASK_ID_PATTERN = /^[0-9a-f-]{36}$/;
const MAX_CAPTURE_BYTES = 20 * 1024 * 1024;
const MAX_TASKS = 100;

type TaskListener = (task: MusicDownloadTask) => void;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function finiteNumber(value: unknown): number | undefined {
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) && number >= 0 ? number : undefined;
}

function bestThumbnail(value: unknown): string | undefined {
  if (!Array.isArray(value)) return undefined;
  const urls = value
    .filter(isRecord)
    .map((thumbnail) => typeof thumbnail.url === 'string' ? thumbnail.url.trim() : '')
    .filter((url) => /^https:\/\//i.test(url));
  return urls.at(-1);
}

function parseSearchItem(value: unknown): MusicSearchItem | null {
  if (!isRecord(value) || typeof value.id !== 'string' || !YOUTUBE_ID_PATTERN.test(value.id)) {
    return null;
  }
  const title = typeof value.title === 'string' ? value.title.trim() : '';
  if (!title) return null;
  const channel = [value.channel, value.uploader]
    .find((candidate) => typeof candidate === 'string' && candidate.trim()) as string | undefined;
  return {
    id: value.id,
    title,
    channel: channel?.trim() || '未知频道',
    duration: finiteNumber(value.duration) ?? 0,
    cover: bestThumbnail(value.thumbnails),
  };
}

export function parseProgressLine(line: string): {
  downloadedBytes: number;
  totalBytes?: number;
  speedBytesPerSecond?: number;
  etaSeconds?: number;
} | null {
  if (!line.startsWith('LYRALUME_PROGRESS:')) return null;
  const [downloadedRaw, estimatedRaw, totalRaw, speedRaw, etaRaw] = line
    .slice('LYRALUME_PROGRESS:'.length)
    .split('|');
  const downloadedBytes = finiteNumber(downloadedRaw) ?? 0;
  return {
    downloadedBytes,
    totalBytes: finiteNumber(totalRaw) ?? finiteNumber(estimatedRaw),
    speedBytesPerSecond: finiteNumber(speedRaw),
    etaSeconds: finiteNumber(etaRaw),
  };
}

function createLineConsumer(onLine: (line: string) => void): {
  push(chunk: Buffer): void;
  finish(): void;
} {
  let pending = '';
  return {
    push(chunk) {
      pending += chunk.toString('utf8');
      const lines = pending.split(/\r?\n/);
      pending = lines.pop() ?? '';
      for (const line of lines) onLine(line.trim());
    },
    finish() {
      if (pending.trim()) onLine(pending.trim());
      pending = '';
    },
  };
}

export class MusicDownloadService {
  private readonly tasks = new Map<string, MusicDownloadTask>();
  private readonly activeTaskByMusicId = new Map<string, string>();
  private readonly processes = new Map<string, ChildProcess>();
  private listener?: TaskListener;
  private queue: Promise<void> = Promise.resolve();
  private closing = false;

  constructor(
    private readonly settings: AppSettingsService,
    private readonly runtime: MusicDownloadRuntime,
    private readonly tempDirectory: string,
    private readonly onDownloaded?: (filePath: string) => void,
  ) {}

  setListener(listener: TaskListener): void {
    this.listener = listener;
  }

  getRuntime(): MusicRuntimeSnapshot {
    return musicRuntimeSnapshot(this.runtime);
  }

  getTasks(): MusicDownloadTask[] {
    return [...this.tasks.values()]
      .sort((left, right) => right.createdAt - left.createdAt)
      .map((task) => ({ ...task }));
  }

  async search(keyword: string, limit = 30): Promise<MusicSearchResult> {
    const normalizedKeyword = keyword.trim();
    if (!normalizedKeyword || normalizedKeyword.length > 200) {
      throw new Error('搜索关键词必须为 1 到 200 个字符');
    }
    const normalizedLimit = Math.max(1, Math.min(30, Math.trunc(limit)));
    this.assertRuntime(false);
    const argumentsList = [
      ...(await this.commonArguments()),
      '--dump-single-json',
      '--flat-playlist',
      '--playlist-end',
      String(normalizedLimit),
      '--',
      `ytsearch${normalizedLimit}:${normalizedKeyword}`,
    ];
    const { stdout } = await this.capture(argumentsList, 60_000);
    let payload: unknown;
    try {
      payload = JSON.parse(stdout);
    } catch {
      throw new Error('音乐搜索返回了无法识别的数据');
    }
    if (!isRecord(payload) || !Array.isArray(payload.entries)) {
      throw new Error('音乐搜索结果格式不正确');
    }
    const results = payload.entries
      .map(parseSearchItem)
      .filter((item): item is MusicSearchItem => Boolean(item));
    return { keyword: normalizedKeyword, results };
  }

  async startDownload(request: MusicDownloadRequest): Promise<MusicDownloadTask> {
    if (this.closing) throw new Error('应用正在退出，不能创建下载任务');
    this.assertRequest(request);
    this.assertRuntime(true);
    const activeTaskId = this.activeTaskByMusicId.get(request.musicId);
    if (activeTaskId) {
      const activeTask = this.tasks.get(activeTaskId);
      if (activeTask) return { ...activeTask };
    }
    const now = Date.now();
    const task: MusicDownloadTask = {
      id: randomUUID(),
      musicId: request.musicId,
      title: request.title.trim(),
      channel: request.channel.trim() || '未知频道',
      cover: request.cover,
      status: 'queued',
      progress: 0,
      downloadedBytes: 0,
      createdAt: now,
      updatedAt: now,
    };
    this.tasks.set(task.id, task);
    this.pruneTasks();
    this.activeTaskByMusicId.set(task.musicId, task.id);
    this.emit(task);
    const scheduled = this.queue.then(() => this.runDownload(task.id));
    this.queue = scheduled.catch(() => undefined);
    return { ...task };
  }

  cancelDownload(taskId: string): MusicDownloadTask {
    if (!TASK_ID_PATTERN.test(taskId)) throw new Error('无效的下载任务标识');
    const task = this.tasks.get(taskId);
    if (!task) throw new Error('下载任务不存在');
    if (['completed', 'cancelled', 'failed'].includes(task.status)) return { ...task };
    this.update(task, { status: 'cancelled', error: undefined });
    this.activeTaskByMusicId.delete(task.musicId);
    const child = this.processes.get(task.id);
    if (child) this.terminateProcess(child);
    return { ...task };
  }

  async close(): Promise<void> {
    this.closing = true;
    for (const task of this.tasks.values()) {
      if (task.status === 'queued' || task.status === 'running' || task.status === 'postprocessing') {
        this.cancelDownload(task.id);
      }
    }
    await this.queue.catch(() => undefined);
  }

  private async commonArguments(): Promise<string[]> {
    const argumentsList = [
      '--ignore-config',
      '--no-warnings',
      '--no-colors',
      '--encoding',
      'utf-8',
      '--js-runtimes',
      `node:${this.runtime.nodePath}`,
      '--remote-components',
      'ejs:github',
    ];
    const proxyUrl = this.settings.getProxyUrl();
    if (proxyUrl) argumentsList.push('--proxy', proxyUrl);
    const cookiePath = await this.settings.getCookiePath();
    if (cookiePath) argumentsList.push('--cookies', cookiePath);
    return argumentsList;
  }

  private async runDownload(taskId: string): Promise<void> {
    const task = this.tasks.get(taskId);
    if (!task || task.status === 'cancelled') return;
    const downloadDirectory = this.settings.getDownloadDirectory();
    await Promise.all([
      mkdir(downloadDirectory, { recursive: true }),
      mkdir(this.tempDirectory, { recursive: true }),
    ]);
    this.update(task, { status: 'running', progress: 0.01, error: undefined });

    const argumentsList = [
      ...(await this.commonArguments()),
      '--newline',
      '--progress',
      '--progress-delta',
      '0.25',
      '--progress-template',
      'download:LYRALUME_PROGRESS:%(progress.downloaded_bytes)s|%(progress.total_bytes_estimate)s|%(progress.total_bytes)s|%(progress.speed)s|%(progress.eta)s',
      '--print',
      'after_move:LYRALUME_FILE:%(filepath)s',
      '--no-playlist',
      '--no-overwrites',
      '--windows-filenames',
      '--trim-filenames',
      '180',
      '--format',
      'bestaudio/best',
      '--extract-audio',
      '--audio-format',
      'mp3',
      '--audio-quality',
      '320K',
      '--embed-thumbnail',
      '--convert-thumbnails',
      'jpg',
      '--embed-metadata',
      '--paths',
      downloadDirectory,
      '--paths',
      `temp:${this.tempDirectory}`,
      '--output',
      '%(title).180B [%(id)s].%(ext)s',
    ];
    if (path.isAbsolute(this.runtime.ffmpegPath)) {
      argumentsList.push('--ffmpeg-location', this.runtime.ffmpegPath);
    }
    argumentsList.push('--', `https://www.youtube.com/watch?v=${task.musicId}`);

    let finalPath = '';
    const diagnosticLines: string[] = [];
    try {
      await new Promise<void>((resolve, reject) => {
        const child = spawn(this.runtime.ytDlpPath, argumentsList, {
          env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
          shell: false,
          windowsHide: true,
          stdio: ['ignore', 'pipe', 'pipe'],
        });
        this.processes.set(task.id, child);
        const consume = (line: string): void => {
          if (!line) return;
          if (line.startsWith('LYRALUME_FILE:')) {
            finalPath = line.slice('LYRALUME_FILE:'.length).trim();
            return;
          }
          const progress = parseProgressLine(line);
          if (progress) {
            const ratio = progress.totalBytes
              ? Math.min(0.95, progress.downloadedBytes / progress.totalBytes)
              : Math.max(task.progress, 0.02);
            this.update(task, {
              status: 'running',
              progress: ratio,
              downloadedBytes: progress.downloadedBytes,
              totalBytes: progress.totalBytes,
              speedBytesPerSecond: progress.speedBytesPerSecond,
              etaSeconds: progress.etaSeconds,
            });
            return;
          }
          if (/^\[(?:ExtractAudio|Metadata|EmbedThumbnail|ThumbnailsConvertor)\]/.test(line)) {
            this.update(task, { status: 'postprocessing', progress: Math.max(task.progress, 0.96) });
          }
        };
        const stdout = createLineConsumer(consume);
        const stderr = createLineConsumer((line) => {
          diagnosticLines.push(line);
          if (diagnosticLines.length > 30) diagnosticLines.shift();
          consume(line);
        });
        child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
        child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
        child.once('error', (error: NodeJS.ErrnoException) => {
          reject(new Error(error.code === 'ENOENT'
            ? `找不到 yt-dlp：${this.runtime.ytDlpPath}`
            : `yt-dlp 无法启动：${error.message}`));
        });
        child.once('close', (code) => {
          stdout.finish();
          stderr.finish();
          this.processes.delete(task.id);
          if (this.isCancelled(task.id)) {
            resolve();
          } else if (code === 0) {
            resolve();
          } else {
            reject(new Error(diagnosticLines.at(-1) || `yt-dlp 已退出，代码 ${code ?? 'unknown'}`));
          }
        });
      });
      if (this.isCancelled(task.id)) return;
      const outputFileName = this.resolveOutputFileName(finalPath);
      if (!outputFileName) throw new Error('下载完成，但没有找到生成的 MP3 文件');
      this.onDownloaded?.(path.join(this.settings.getDownloadDirectory(), outputFileName));
      this.update(task, {
        status: 'completed',
        progress: 1,
        outputFileName,
        etaSeconds: 0,
        speedBytesPerSecond: undefined,
        error: undefined,
      });
    } catch (error) {
      if (!this.isCancelled(task.id)) {
        const message = this.redactError(error instanceof Error ? error.message : '音乐下载失败');
        logger.warn(`[music-download:${task.id}] ${message}`);
        this.update(task, { status: 'failed', error: message });
      }
    } finally {
      this.processes.delete(task.id);
      this.activeTaskByMusicId.delete(task.musicId);
    }
  }

  private async capture(argumentsList: string[], timeoutMs: number): Promise<{ stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
      const child = spawn(this.runtime.ytDlpPath, argumentsList, {
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
        shell: false,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];
      let capturedBytes = 0;
      let settled = false;
      const timer = setTimeout(() => {
        this.terminateProcess(child);
        finish(new Error('音乐搜索超时，请稍后重试'));
      }, timeoutMs);
      const finish = (error?: Error): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (error) reject(error);
        else resolve({ stdout: Buffer.concat(stdout).toString('utf8'), stderr: Buffer.concat(stderr).toString('utf8') });
      };
      const collect = (target: Buffer[]) => (chunk: Buffer): void => {
        capturedBytes += chunk.byteLength;
        if (capturedBytes > MAX_CAPTURE_BYTES) {
          this.terminateProcess(child);
          finish(new Error('音乐搜索响应过大，已停止处理'));
          return;
        }
        target.push(chunk);
      };
      child.stdout.on('data', collect(stdout));
      child.stderr.on('data', collect(stderr));
      child.once('error', (error: NodeJS.ErrnoException) => finish(new Error(error.code === 'ENOENT'
        ? `找不到 yt-dlp：${this.runtime.ytDlpPath}`
        : `yt-dlp 无法启动：${error.message}`)));
      child.once('close', (code) => {
        if (settled) return;
        if (code === 0) finish();
        else {
          const detail = Buffer.concat(stderr).toString('utf8').trim().split(/\r?\n/).at(-1);
          finish(new Error(this.redactError(detail || `音乐搜索失败，yt-dlp 退出代码 ${code ?? 'unknown'}`)));
        }
      });
    });
  }

  private resolveOutputFileName(finalPath: string): string | undefined {
    if (finalPath) {
      const downloadDirectory = path.resolve(this.settings.getDownloadDirectory());
      const resolvedOutput = path.resolve(finalPath);
      const relative = path.relative(downloadDirectory, resolvedOutput);
      if (relative && !relative.startsWith('..') && !path.isAbsolute(relative)) return path.basename(resolvedOutput);
    }
    return undefined;
  }

  private assertRuntime(needsFfmpeg: boolean): void {
    const snapshot = this.getRuntime();
    if (!snapshot.ytDlpAvailable) throw new Error('未找到本地 yt-dlp，请先准备下载运行时');
    if (needsFfmpeg && !snapshot.ffmpegAvailable) throw new Error('未找到本地 FFmpeg，无法生成 320 kbps MP3');
  }

  private assertRequest(request: MusicDownloadRequest): void {
    if (!YOUTUBE_ID_PATTERN.test(request.musicId)) throw new Error('无效的 YouTube 音乐标识');
    if (!request.title.trim() || request.title.trim().length > 500) throw new Error('无效的音乐标题');
    if (request.channel.length > 500) throw new Error('无效的频道名称');
    if (request.cover && !/^https:\/\//i.test(request.cover)) throw new Error('无效的封面地址');
  }

  private update(task: MusicDownloadTask, patch: Partial<MusicDownloadTask>): void {
    Object.assign(task, patch, { updatedAt: Date.now() });
    this.emit(task);
  }

  private isCancelled(taskId: string): boolean {
    return this.tasks.get(taskId)?.status === 'cancelled';
  }

  private emit(task: MusicDownloadTask): void {
    this.listener?.({ ...task });
  }

  private pruneTasks(): void {
    if (this.tasks.size <= MAX_TASKS) return;
    const removable = [...this.tasks.values()]
      .filter((task) => ['completed', 'cancelled', 'failed'].includes(task.status))
      .sort((left, right) => left.updatedAt - right.updatedAt);
    while (this.tasks.size > MAX_TASKS && removable.length > 0) {
      const task = removable.shift();
      if (task) this.tasks.delete(task.id);
    }
  }

  private redactError(message: string): string {
    let redacted = message;
    const proxyUrl = this.settings.getProxyUrl();
    if (proxyUrl) redacted = redacted.replaceAll(proxyUrl, '<proxy>');
    return redacted.replace(/(?:--cookies\s+)?[^\s"']*youtube-cookies\.txt/gi, '<cookie-file>');
  }

  private terminateProcess(child: ChildProcess): void {
    if (!child.pid || child.killed) return;
    if (process.platform === 'win32') {
      const killer = spawn('taskkill.exe', ['/pid', String(child.pid), '/t', '/f'], {
        shell: false,
        windowsHide: true,
        stdio: 'ignore',
      });
      killer.unref();
    } else child.kill('SIGTERM');
  }
}
