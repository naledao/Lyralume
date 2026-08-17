import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  resolveLocalLyricsPythonExecutables,
  resolveSystemPythonExecutable,
} from './python-environment.js';

describe('local lyrics Python environment resolution', () => {
  it('uses the independently configured worker environments first', () => {
    const probe = vi.fn();

    expect(resolveLocalLyricsPythonExecutables({
      environment: {
        LYRALUME_UVR_PYTHON: ' D:\\python-envs\\uvr\\python.exe ',
        LYRALUME_WHISPERX_PYTHON: 'D:\\python-envs\\whisperx\\python.exe',
      },
      platform: 'win32',
      probe,
    })).toEqual({
      uvrPython: 'D:\\python-envs\\uvr\\python.exe',
      whisperPython: 'D:\\python-envs\\whisperx\\python.exe',
    });
    expect(probe).not.toHaveBeenCalled();
  });

  it('supports one explicitly configured system Python for both workers', () => {
    expect(resolveLocalLyricsPythonExecutables({
      environment: { LYRALUME_PYTHON: 'C:\\Python311\\python.exe' },
      platform: 'win32',
    })).toEqual({
      uvrPython: 'C:\\Python311\\python.exe',
      whisperPython: 'C:\\Python311\\python.exe',
    });
  });

  it('prefers the application-managed worker environments over system Python', () => {
    const managedRoot = 'C:\\Users\\current-user\\AppData\\Roaming\\lyralume\\ai';
    const uvrPython = path.win32.join(managedRoot, 'uvr', '.venv', 'Scripts', 'python.exe');
    const whisperPython = path.win32.join(
      managedRoot,
      'whisperx',
      '.venv',
      'Scripts',
      'python.exe',
    );
    const probe = vi.fn();

    expect(resolveLocalLyricsPythonExecutables({
      environment: {},
      managedEnvironmentRoot: managedRoot,
      platform: 'win32',
      pathExists: (candidate) => candidate === uvrPython || candidate === whisperPython,
      probe,
    })).toEqual({ uvrPython, whisperPython });
    expect(probe).not.toHaveBeenCalled();
  });

  it('keeps an explicit shared Python ahead of managed environments', () => {
    const configuredPython = 'C:\\Python311\\python.exe';

    expect(resolveLocalLyricsPythonExecutables({
      environment: { LYRALUME_PYTHON: configuredPython },
      managedEnvironmentRoot: 'C:\\managed-ai',
      platform: 'win32',
      pathExists: () => true,
    })).toEqual({
      uvrPython: configuredPython,
      whisperPython: configuredPython,
    });
  });

  it('prefers the active virtual environment inherited from the computer', () => {
    const virtualEnvironment = 'C:\\work\\.venv';
    const expected = path.win32.join(virtualEnvironment, 'Scripts', 'python.exe');

    expect(resolveSystemPythonExecutable({
      environment: { VIRTUAL_ENV: virtualEnvironment },
      platform: 'win32',
      pathExists: (candidate) => candidate === expected,
      probe: vi.fn(),
    })).toBe(expected);
  });

  it('asks the Windows launcher for the installed Python 3.11 executable', () => {
    const installedPython = 'C:\\Users\\current-user\\Python311\\python.exe';
    const probe = vi.fn((command: string, args: string[]) => (
      command === 'py' && args[0] === '-3.11' ? installedPython : undefined
    ));

    expect(resolveSystemPythonExecutable({
      environment: { PATH: 'C:\\Windows' },
      platform: 'win32',
      pathExists: (candidate) => candidate === installedPython,
      probe,
    })).toBe(installedPython);
    expect(probe).toHaveBeenCalledWith('py', ['-3.11'], { PATH: 'C:\\Windows' });
  });

  it('falls back to commands from PATH when a launcher is unavailable', () => {
    const installedPython = '/usr/local/bin/python3';

    expect(resolveSystemPythonExecutable({
      environment: { PATH: '/usr/local/bin:/usr/bin' },
      platform: 'linux',
      pathExists: (candidate) => candidate === installedPython,
      probe: (command) => command === 'python3' ? installedPython : undefined,
    })).toBe(installedPython);
  });
});
