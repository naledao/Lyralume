import { existsSync } from 'node:fs';
import path from 'node:path';
import type { MusicRuntimeSnapshot } from '../../shared/contracts.js';

export interface MusicDownloadRuntime {
  ytDlpPath: string;
  ffmpegPath: string;
  nodePath: string;
}

function resolveBundledTool(options: {
  appPath: string;
  resourcesPath: string;
  packaged: boolean;
}, directory: string, executable: string): string | undefined {
  const packagedPath = path.join(options.resourcesPath, 'tools', directory, executable);
  const projectPath = path.join(options.appPath, 'tools', directory, executable);
  const candidates = options.packaged
    ? [packagedPath, projectPath]
    : [projectPath, packagedPath];
  return candidates.find((candidate) => existsSync(candidate));
}

function commandExists(command: string, environment: NodeJS.ProcessEnv = process.env): boolean {
  if (path.isAbsolute(command) || command.includes('/') || command.includes('\\')) {
    return existsSync(command);
  }
  const pathValue = environment.Path ?? environment.PATH ?? '';
  const extensions = process.platform === 'win32'
    ? (environment.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').split(';')
    : [''];
  const hasExtension = Boolean(path.extname(command));
  return pathValue.split(path.delimiter).some((directory) => {
    if (!directory) return false;
    const candidates = hasExtension ? [command] : extensions.map((extension) => `${command}${extension}`);
    return candidates.some((candidate) => existsSync(path.join(directory, candidate)));
  });
}

export function resolveMusicDownloadRuntime(options: {
  appPath: string;
  resourcesPath: string;
  packaged: boolean;
  environment?: NodeJS.ProcessEnv;
  nodePath?: string;
}): MusicDownloadRuntime {
  const environment = options.environment ?? process.env;
  const bundledYtDlp = resolveBundledTool(options, 'yt-dlp', 'yt-dlp.exe');
  const bundledFfmpeg = resolveBundledTool(options, 'ffmpeg', 'ffmpeg.exe');
  return {
    ytDlpPath: environment.LYRALUME_YTDLP_PATH || bundledYtDlp || 'yt-dlp',
    ffmpegPath: environment.LYRALUME_FFMPEG_PATH || bundledFfmpeg || 'ffmpeg',
    nodePath: options.nodePath ?? process.execPath,
  };
}

export function musicRuntimeSnapshot(runtime: MusicDownloadRuntime): MusicRuntimeSnapshot {
  return {
    ytDlpAvailable: commandExists(runtime.ytDlpPath),
    ytDlpPath: runtime.ytDlpPath,
    ffmpegAvailable: commandExists(runtime.ffmpegPath),
    ffmpegPath: runtime.ffmpegPath,
  };
}
