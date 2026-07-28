import path from 'node:path';
import { app } from 'electron';
import type { LocalLyricsRuntimeOptions } from './local-lyrics-service.js';
import { shouldUsePackagedResources } from '../runtime-mode.js';
import { resolveLocalLyricsPythonExecutables } from './python-environment.js';

export interface ResolvedLocalLyricsRuntime {
  options: LocalLyricsRuntimeOptions;
  uvrPython: string;
  whisperPython: string;
  uvrScript: string;
  whisperScript: string;
}

export function resolveLocalLyricsRuntime(userDataPath: string): ResolvedLocalLyricsRuntime {
  const workerRoot = shouldUsePackagedResources(app.isPackaged)
    ? path.join(process.resourcesPath, 'workers')
    : path.join(app.getAppPath(), 'workers');
  const python = resolveLocalLyricsPythonExecutables();
  return {
    options: {
      cacheRoot: path.join(userDataPath, 'cache', 'lyrics-tasks'),
      modelRoot: path.join(userDataPath, 'models'),
      modelSettingsPath: path.join(userDataPath, 'models', 'local-lyrics-settings.json'),
      defaultDevice: process.env.LYRALUME_AI_DEVICE === 'cpu' ? 'cpu' : 'cuda',
    },
    uvrPython: python.uvrPython,
    whisperPython: python.whisperPython,
    uvrScript: path.join(workerRoot, 'uvr', 'worker.py'),
    whisperScript: path.join(workerRoot, 'whisperx', 'worker.py'),
  };
}
