// @vitest-environment node

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { LrcSaveError, saveLrcAtomically, sidecarLrcPath } from './safe-lrc';

const temporaryDirectories: string[] = [];

async function fixture(): Promise<{ directory: string; audioPath: string; lrcPath: string }> {
  const directory = await mkdtemp(path.join(tmpdir(), 'lyralume-lrc-test-'));
  temporaryDirectories.push(directory);
  const audioPath = path.join(directory, 'song.flac');
  await writeFile(audioPath, 'audio');
  return { directory, audioPath, lrcPath: sidecarLrcPath(audioPath) };
}

afterEach(async () => {
  for (const directory of temporaryDirectories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

describe('safe LRC saving', () => {
  it('creates a UTF-8 sidecar and refuses a silent overwrite', async () => {
    const { audioPath, lrcPath } = await fixture();
    await saveLrcAtomically(audioPath, '[00:01.00]First');
    expect(await readFile(lrcPath, 'utf8')).toBe('[00:01.00]First\n');

    await expect(saveLrcAtomically(audioPath, '[00:02.00]Second'))
      .rejects.toMatchObject<LrcSaveError>({ kind: 'existing' });
    expect(await readFile(lrcPath, 'utf8')).toBe('[00:01.00]First\n');
  });

  it('replaces only after explicit overwrite confirmation', async () => {
    const { audioPath, lrcPath } = await fixture();
    await writeFile(lrcPath, '[00:01.00]Old');
    await saveLrcAtomically(audioPath, '[00:02.00]New', true);
    expect(await readFile(lrcPath, 'utf8')).toBe('[00:02.00]New\n');
  });

  it('rejects lyrics without synchronized timestamps', async () => {
    const { audioPath } = await fixture();
    await expect(saveLrcAtomically(audioPath, 'plain lyrics'))
      .rejects.toMatchObject<LrcSaveError>({ kind: 'invalid' });
  });
});
