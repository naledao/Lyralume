// @vitest-environment node

import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { LocalLyricsModelSettingsStore } from './model-settings';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => (
    rm(directory, { recursive: true, force: true })
  )));
});

describe('LocalLyricsModelSettingsStore', () => {
  it('persists an external UVR model path without moving or changing the model', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'lyralume-model-settings-'));
    temporaryDirectories.push(directory);
    const settingsPath = path.join(directory, 'settings', 'models.json');
    const managedPath = path.join(directory, 'managed', 'default.ckpt');
    const customPath = path.join(directory, 'downloads', 'custom UVR.ckpt');
    await mkdir(path.dirname(customPath), { recursive: true });
    await writeFile(customPath, 'user-owned-model');
    const store = new LocalLyricsModelSettingsStore(settingsPath, managedPath);

    const selected = await store.setCustomUvrModel(customPath);
    const reloaded = await new LocalLyricsModelSettingsStore(settingsPath, managedPath).get();

    expect(selected).toMatchObject({
      uvrModelSource: 'custom',
      uvrModelPath: customPath,
      uvrModelName: 'custom UVR.ckpt',
      uvrModelAvailable: true,
    });
    expect(reloaded).toEqual(selected);
    await expect(readFile(customPath, 'utf8')).resolves.toBe('user-owned-model');
  });

  it('restores the managed model and rejects missing or unsupported custom files', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'lyralume-model-settings-'));
    temporaryDirectories.push(directory);
    const settingsPath = path.join(directory, 'settings.json');
    const managedPath = path.join(directory, 'managed', 'default.ckpt');
    const store = new LocalLyricsModelSettingsStore(settingsPath, managedPath);

    await expect(store.setCustomUvrModel(path.join(directory, 'missing.ckpt')))
      .rejects.toThrow('不存在、为空或无法读取');
    const unsupported = path.join(directory, 'model.zip');
    await writeFile(unsupported, 'zip');
    await expect(store.setCustomUvrModel(unsupported)).rejects.toThrow('.ckpt、.pt 或 .pth');
    await mkdir(path.dirname(managedPath), { recursive: true });
    await writeFile(managedPath, 'managed-model');

    const restored = await store.resetUvrModel();
    expect(restored).toMatchObject({
      uvrModelSource: 'managed',
      uvrModelPath: managedPath,
      uvrModelAvailable: true,
    });
  });
});
