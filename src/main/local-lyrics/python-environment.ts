import { existsSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const PRINT_EXECUTABLE_SCRIPT = 'import os, sys; print(os.path.realpath(sys.executable))';

interface PythonProbeCommand {
  command: string;
  args: string[];
}

export interface PythonEnvironmentResolverOptions {
  environment?: NodeJS.ProcessEnv;
  managedEnvironmentRoot?: string;
  platform?: NodeJS.Platform;
  pathExists?: (candidate: string) => boolean;
  probe?: (
    command: string,
    args: string[],
    environment: NodeJS.ProcessEnv,
  ) => string | undefined;
}

function managedWorkerExecutable(
  root: string,
  worker: 'uvr' | 'whisperx',
  platform: NodeJS.Platform,
): string {
  const platformPath = platform === 'win32' ? path.win32 : path.posix;
  const executableParts = platform === 'win32'
    ? ['Scripts', 'python.exe']
    : ['bin', 'python'];
  return platformPath.join(root, worker, '.venv', ...executableParts);
}

export interface LocalLyricsPythonExecutables {
  uvrPython: string;
  whisperPython: string;
}

function cleanEnvironmentValue(value: string | undefined): string | undefined {
  const cleaned = value?.trim();
  return cleaned || undefined;
}

function defaultProbe(
  command: string,
  args: string[],
  environment: NodeJS.ProcessEnv,
): string | undefined {
  const result = spawnSync(command, [...args, '-c', PRINT_EXECUTABLE_SCRIPT], {
    encoding: 'utf8',
    env: environment,
    shell: false,
    windowsHide: true,
    timeout: 5_000,
  });
  if (result.error || result.status !== 0) return undefined;
  return result.stdout
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .find(Boolean);
}

function activeEnvironmentCandidates(
  environment: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
): string[] {
  const platformPath = platform === 'win32' ? path.win32 : path.posix;
  const executableParts = platform === 'win32'
    ? ['Scripts', 'python.exe']
    : ['bin', 'python'];
  return [environment.VIRTUAL_ENV, environment.CONDA_PREFIX]
    .map(cleanEnvironmentValue)
    .filter((root): root is string => Boolean(root))
    .map((root) => platformPath.join(root, ...executableParts));
}

function systemProbeCommands(platform: NodeJS.Platform): PythonProbeCommand[] {
  if (platform === 'win32') {
    return [
      { command: 'py', args: ['-3.11'] },
      { command: 'py', args: [] },
      { command: 'python', args: [] },
      { command: 'python3', args: [] },
    ];
  }
  return [
    { command: 'python3', args: [] },
    { command: 'python', args: [] },
  ];
}

/**
 * Finds Python from the environment inherited by Lyralume. No user-specific
 * installation directory is assumed: active virtual/Conda environments are
 * preferred, followed by the Windows launcher or commands available on PATH.
 */
export function resolveSystemPythonExecutable(
  options: PythonEnvironmentResolverOptions = {},
): string {
  const environment = options.environment ?? process.env;
  const platform = options.platform ?? process.platform;
  const pathExists = options.pathExists ?? existsSync;
  const probe = options.probe ?? defaultProbe;

  for (const candidate of activeEnvironmentCandidates(environment, platform)) {
    if (pathExists(candidate)) return candidate;
  }

  for (const candidate of systemProbeCommands(platform)) {
    const executable = probe(candidate.command, candidate.args, environment);
    if (executable && pathExists(executable)) return executable;
  }

  // Keep the final fallback portable and let child_process report a clear
  // not-configured error if Python is not installed at all.
  return platform === 'win32' ? 'py' : 'python3';
}

export function resolveLocalLyricsPythonExecutables(
  options: PythonEnvironmentResolverOptions = {},
): LocalLyricsPythonExecutables {
  const environment = options.environment ?? process.env;
  const platform = options.platform ?? process.platform;
  const pathExists = options.pathExists ?? existsSync;
  const sharedPython = cleanEnvironmentValue(environment.LYRALUME_PYTHON);
  const configuredUvr = cleanEnvironmentValue(environment.LYRALUME_UVR_PYTHON);
  const configuredWhisper = cleanEnvironmentValue(environment.LYRALUME_WHISPERX_PYTHON);
  if (configuredUvr && configuredWhisper) {
    return {
      uvrPython: configuredUvr,
      whisperPython: configuredWhisper,
    };
  }

  const managedRoot = cleanEnvironmentValue(options.managedEnvironmentRoot);
  const managedUvr = managedRoot
    ? managedWorkerExecutable(managedRoot, 'uvr', platform)
    : undefined;
  const managedWhisper = managedRoot
    ? managedWorkerExecutable(managedRoot, 'whisperx', platform)
    : undefined;
  const availableManagedUvr = managedUvr && pathExists(managedUvr) ? managedUvr : undefined;
  const availableManagedWhisper = managedWhisper && pathExists(managedWhisper)
    ? managedWhisper
    : undefined;
  let detectedPython: string | undefined;
  const systemPython = (): string => {
    detectedPython ??= resolveSystemPythonExecutable({ ...options, environment, platform });
    return detectedPython;
  };

  return {
    uvrPython: configuredUvr
      ?? sharedPython
      ?? availableManagedUvr
      ?? systemPython(),
    whisperPython: configuredWhisper
      ?? sharedPython
      ?? availableManagedWhisper
      ?? systemPython(),
  };
}
