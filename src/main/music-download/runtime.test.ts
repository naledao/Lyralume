// @vitest-environment node

import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { musicRuntimeSnapshot, resolveMusicDownloadRuntime } from './runtime.js';

const temporaryDirectories: string[] = [];

function createTemporaryDirectory(): string {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'lyralume-runtime-'));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('resolveMusicDownloadRuntime', () => {
  it('finds installer resources even when Electron reports development mode', () => {
    const root = createTemporaryDirectory();
    const appPath = path.join(root, 'resources', 'app.asar');
    const resourcesPath = path.join(root, 'resources');
    const ytDlpPath = path.join(resourcesPath, 'tools', 'yt-dlp', 'yt-dlp.exe');
    const ffmpegPath = path.join(resourcesPath, 'tools', 'ffmpeg', 'ffmpeg.exe');
    mkdirSync(path.dirname(ytDlpPath), { recursive: true });
    mkdirSync(path.dirname(ffmpegPath), { recursive: true });
    writeFileSync(ytDlpPath, 'test');
    writeFileSync(ffmpegPath, 'test');

    const runtime = resolveMusicDownloadRuntime({
      appPath,
      resourcesPath,
      packaged: false,
      environment: {},
    });

    expect(runtime.ytDlpPath).toBe(ytDlpPath);
    expect(runtime.ffmpegPath).toBe(ffmpegPath);
    expect(musicRuntimeSnapshot(runtime)).toMatchObject({
      ytDlpAvailable: true,
      ffmpegAvailable: true,
    });
  });

  it('prefers explicit environment overrides', () => {
    const root = createTemporaryDirectory();
    const runtime = resolveMusicDownloadRuntime({
      appPath: root,
      resourcesPath: path.join(root, 'resources'),
      packaged: true,
      environment: {
        LYRALUME_YTDLP_PATH: 'custom-yt-dlp',
        LYRALUME_FFMPEG_PATH: 'custom-ffmpeg',
      },
    });

    expect(runtime.ytDlpPath).toBe('custom-yt-dlp');
    expect(runtime.ffmpegPath).toBe('custom-ffmpeg');
  });
});
