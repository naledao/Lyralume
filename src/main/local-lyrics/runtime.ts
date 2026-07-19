import path from 'node:path';
import { app } from 'electron';
import type { LocalLyricsRuntimeOptions } from './local-lyrics-service.js';

export interface ResolvedLocalLyricsRuntime {
  options: LocalLyricsRuntimeOptions;
  uvrPython: string;
  whisperPython: string;
  uvrScript: string;
  whisperScript: string;
}

export function resolveLocalLyricsRuntime(userDataPath: string): ResolvedLocalLyricsRuntime {
  const workerRoot = app.isPackaged
    ? path.join(process.resourcesPath, 'workers')
    : path.join(app.getAppPath(), 'workers');
  const aiRoot = path.join(userDataPath, 'ai');
  return {
    options: {
      cacheRoot: path.join(userDataPath, 'cache', 'lyrics-tasks'),
      modelRoot: path.join(userDataPath, 'models'),
      modelSettingsPath: path.join(userDataPath, 'models', 'local-lyrics-settings.json'),
      defaultDevice: process.env.LYRALUME_AI_DEVICE === 'cpu' ? 'cpu' : 'cuda',
    },
    uvrPython: process.env.LYRALUME_UVR_PYTHON
      ?? path.join(aiRoot, 'uvr', '.venv', 'Scripts', 'python.exe'),
    whisperPython: process.env.LYRALUME_WHISPERX_PYTHON
      ?? path.join(aiRoot, 'whisperx', '.venv', 'Scripts', 'python.exe'),
    uvrScript: path.join(workerRoot, 'uvr', 'worker.py'),
    whisperScript: path.join(workerRoot, 'whisperx', 'worker.py'),
  };
}
