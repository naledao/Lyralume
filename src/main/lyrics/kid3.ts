import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseFile } from 'music-metadata';
import {
  normalizeTrackLanguage,
  type TrackMetadata,
  type TrackMetadataUpdate,
} from '../../shared/contracts.js';
import { parseLrc } from '../../shared/lrc.js';

interface ProcessResult {
  stdout: string;
  stderr: string;
}

export type ProcessRunner = (executable: string, args: string[]) => Promise<ProcessResult>;

export interface EmbeddedSyncedLyrics {
  descriptor?: string;
  syncText: Array<{
    text: string;
    timestamp?: number;
  }>;
}

export type SyltReader = (audioPath: string) => Promise<EmbeddedSyncedLyrics[]>;

export type TrackMetadataReader = (audioPath: string) => Promise<Partial<TrackMetadata>>;

export class Kid3Error extends Error {
  constructor(
    readonly kind: 'not_found' | 'command' | 'verification',
    message: string,
  ) {
    super(message);
    this.name = 'Kid3Error';
  }
}

const MAX_OUTPUT_BYTES = 1024 * 1024;

function resolveKid3Executable(): string {
  if (process.platform !== 'win32') return 'kid3-cli';
  const candidates = [
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs', 'Kid3', 'kid3-cli.exe'),
    process.env.ProgramFiles && path.join(process.env.ProgramFiles, 'Kid3', 'kid3-cli.exe'),
    process.env['ProgramFiles(x86)'] && path.join(process.env['ProgramFiles(x86)'], 'Kid3', 'kid3-cli.exe'),
  ].filter((candidate): candidate is string => Boolean(candidate));
  return candidates.find((candidate) => existsSync(candidate)) ?? 'kid3-cli';
}

export const runProcess: ProcessRunner = (executable, args) => new Promise((resolve, reject) => {
  const child = spawn(executable, args, {
    shell: false,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  const timeout = setTimeout(() => {
    child.kill();
    reject(new Kid3Error('command', 'kid3-cli 执行超时'));
  }, 30_000);

  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => {
    if (Buffer.byteLength(stdout, 'utf8') < MAX_OUTPUT_BYTES) stdout += chunk;
  });
  child.stderr.on('data', (chunk: string) => {
    if (Buffer.byteLength(stderr, 'utf8') < MAX_OUTPUT_BYTES) stderr += chunk;
  });
  child.once('error', (error: NodeJS.ErrnoException) => {
    clearTimeout(timeout);
    reject(error.code === 'ENOENT'
      ? new Kid3Error('not_found', '未找到 kid3-cli，请先安装 Kid3 并将其加入 PATH')
      : new Kid3Error('command', `无法启动 kid3-cli：${error.message}`));
  });
  child.once('close', (code) => {
    clearTimeout(timeout);
    if (code === 0) resolve({ stdout, stderr });
    else reject(new Kid3Error('command', stderr.trim() || `kid3-cli 退出码为 ${code ?? '未知'}`));
  });
});

function quoteKid3Path(filePath: string): string {
  if (filePath.includes('"')) throw new Kid3Error('command', '文件路径包含 kid3-cli 无法安全处理的字符');
  return filePath.replace(/\\/g, '/');
}

function quoteKid3Text(value: string): string {
  // Kid3 parses each -c value itself even though the process is launched without
  // a shell. Its CLI syntax uses single-quoted command arguments and backslash
  // escaping for embedded apostrophes.
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

function normalizeEmbeddedText(text: string): string {
  return text.replace(/^[\r\n]+/, '').trim();
}

function lyricsMatch(
  expected: string,
  actual: EmbeddedSyncedLyrics[],
  descriptor = 'Lyralume / LRCLIB',
): boolean {
  const expectedLines = parseLrc(expected).lines;
  const frame = actual.find((lyrics) => lyrics.descriptor === descriptor)
    ?? actual.find((lyrics) => lyrics.syncText.length > 0);
  const actualLines = frame?.syncText ?? [];
  if (expectedLines.length === 0 || expectedLines.length !== actualLines.length) return false;
  return expectedLines.every((line, index) => (
    typeof actualLines[index].timestamp === 'number'
    && Math.abs(line.time * 1000 - actualLines[index].timestamp) <= 30
    && line.text === normalizeEmbeddedText(actualLines[index].text)
  ));
}

const readEmbeddedSylt: SyltReader = async (audioPath) => {
  const metadata = await parseFile(audioPath, { skipCovers: true });
  return metadata.common.lyrics ?? [];
};

export async function readEmbeddedLyricsAsLrc(audioPath: string): Promise<string | undefined> {
  const frames = await readEmbeddedSylt(audioPath);
  const frame = frames.find((lyrics) => lyrics.descriptor === 'Lyralume / Bilingual zh-CN')
    ?? frames.find((lyrics) => lyrics.descriptor === 'Lyralume / Time Adjusted')
    ?? frames.find((lyrics) => lyrics.descriptor === 'Lyralume / LRCLIB')
    ?? frames.find((lyrics) => lyrics.syncText.length > 0);
  const lines = (frame?.syncText ?? []).flatMap((line) => {
    if (typeof line.timestamp !== 'number') return [];
    const totalCentiseconds = Math.max(0, Math.round(line.timestamp / 10));
    const minutes = Math.floor(totalCentiseconds / 6000);
    const seconds = Math.floor((totalCentiseconds % 6000) / 100);
    const centiseconds = totalCentiseconds % 100;
    return [`[${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(centiseconds).padStart(2, '0')}]${normalizeEmbeddedText(line.text)}`];
  });
  return lines.length > 0 ? `${lines.join('\n')}\n` : undefined;
}

const readTrackMetadata: TrackMetadataReader = async (audioPath) => {
  const metadata = await parseFile(audioPath, { skipCovers: true });
  return {
    title: metadata.common.title,
    artist: metadata.common.artist,
    album: metadata.common.album,
    language: normalizeTrackLanguage(metadata.common.language) ?? undefined,
  };
};

export class Kid3Adapter {
  constructor(
    private readonly cacheRoot: string,
    private readonly runner: ProcessRunner = runProcess,
    private readonly syltReader: SyltReader = readEmbeddedSylt,
    private readonly executable = resolveKid3Executable(),
    private readonly metadataReader: TrackMetadataReader = readTrackMetadata,
  ) {}

  async writeMetadataAndVerify(audioPath: string, metadata: TrackMetadataUpdate): Promise<void> {
    const fields = (['title', 'artist', 'album', 'language'] as const).filter(
      (field) => metadata[field] !== undefined,
    );
    if (fields.length === 0) throw new Kid3Error('command', '没有需要写入的歌曲信息');
    const frameNames = {
      title: 'Title',
      artist: 'Artist',
      album: 'Album',
      language: 'Language',
    } as const;
    const commands = fields.flatMap((field) => [
      '-c',
      `set ${frameNames[field]} ${quoteKid3Text(metadata[field] as string)} 2`,
    ]);
    await this.runner(this.executable, [...commands, audioPath]);

    let actual: Partial<TrackMetadata>;
    try {
      actual = await this.metadataReader(audioPath);
    } catch {
      throw new Kid3Error('verification', '无法回读刚写入的歌曲信息');
    }
    const matches = fields.every((field) => (actual[field]?.trim() ?? '') === metadata[field]);
    if (!matches) {
      throw new Kid3Error('verification', '回读结果与要保存的歌曲信息不一致');
    }
  }

  async writeLyricsAndVerify(
    audioPath: string,
    syncedLyrics: string,
    descriptor = 'Lyralume / LRCLIB',
  ): Promise<void> {
    if (parseLrc(syncedLyrics).lines.length === 0) {
      throw new Kid3Error('verification', '候选歌词不包含有效的同步时间戳');
    }
    await mkdir(this.cacheRoot, { recursive: true });
    const temporaryPath = path.join(
      this.cacheRoot,
      `lyrics-${process.pid}-${randomUUID()}.lrc`,
    );
    try {
      await writeFile(temporaryPath, syncedLyrics, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
      await this.writeAndVerify(audioPath, temporaryPath, descriptor);
    } finally {
      await rm(temporaryPath, { force: true }).catch(() => undefined);
    }
  }

  async writeAndVerify(
    audioPath: string,
    lrcPath: string,
    descriptor = 'Lyralume / LRCLIB',
  ): Promise<void> {
    await mkdir(this.cacheRoot, { recursive: true });
    const expected = await readFile(lrcPath, 'utf8');
    const importCommand = `set SYLT:"${quoteKid3Path(lrcPath)}" "${descriptor}" 2`;

    // Kid3/id3lib creates a new SYLT frame as Latin-1 before a caller can edit
    // its fields. Import once to ensure the frame exists, switch it to UTF-16,
    // then import again so non-Latin lyrics are serialized without data loss.
    await this.runner(this.executable, [
      '-c', importCommand,
      '-c', 'set "SYLT.Text Encoding" 1 2',
      '-c', importCommand,
      audioPath,
    ]);

    const encoding = await this.runner(this.executable, [
      '-c', 'get "SYLT.Text Encoding" 2',
      audioPath,
    ]);
    if (!encoding.stdout.split(/\r?\n/).some((line) => line.trim() === '1')) {
      throw new Kid3Error('verification', 'Kid3 未能将同步歌词设置为 UTF-16');
    }

    let actual: EmbeddedSyncedLyrics[];
    try {
      actual = await this.syltReader(audioPath);
    } catch {
      throw new Kid3Error('verification', '无法回读刚写入的同步歌词');
    }
    if (!lyricsMatch(expected, actual, descriptor)) {
      throw new Kid3Error('verification', '回读结果与已保存的 LRC 不一致');
    }
  }
}
