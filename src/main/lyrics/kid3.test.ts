// @vitest-environment node

import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  Kid3Adapter,
  Kid3Error,
  type ProcessRunner,
  type SyltReader,
  type TrackMetadataReader,
} from './kid3';

const temporaryDirectories: string[] = [];

async function fixture(): Promise<{ directory: string; audioPath: string; lrcPath: string }> {
  const directory = await mkdtemp(path.join(tmpdir(), 'lyralume-kid3-test-'));
  temporaryDirectories.push(directory);
  const audioPath = path.join(directory, 'song.flac');
  const lrcPath = path.join(directory, 'song.lrc');
  await writeFile(audioPath, 'audio');
  await writeFile(lrcPath, '[00:01.00]First\n[00:02.00]Second\n');
  return { directory, audioPath, lrcPath };
}

afterEach(async () => {
  for (const directory of temporaryDirectories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

function successfulRunner(): ProcessRunner {
  return vi.fn(async (_executable, args) => ({
    stdout: args[1] === 'get "SYLT.Text Encoding" 2' ? '1\n' : '',
    stderr: '',
  }));
}

function syncedLyrics(...lines: Array<[number, string]>): SyltReader {
  return vi.fn(async () => [{
    descriptor: 'Lyralume / LRCLIB',
    syncText: lines.map(([timestamp, text]) => ({ timestamp, text: `\n ${text}` })),
  }]);
}

describe('Kid3Adapter', () => {
  it('writes title, artist and album to tag 2 and accepts matching readback', async () => {
    const { directory, audioPath } = await fixture();
    const runner = successfulRunner();
    const metadataReader: TrackMetadataReader = vi.fn(async () => ({
      title: "I'll Stay",
      artist: 'The Artist',
      album: 'The Album',
    }));
    const adapter = new Kid3Adapter(
      path.join(directory, 'cache'),
      runner,
      syncedLyrics(),
      'kid3-cli',
      metadataReader,
    );

    await adapter.writeMetadataAndVerify(audioPath, {
      title: "I'll Stay",
      artist: 'The Artist',
      album: 'The Album',
    });

    expect(runner).toHaveBeenCalledOnce();
    expect(vi.mocked(runner).mock.calls[0]).toEqual([
      'kid3-cli',
      [
        '-c', "set Title 'I\\'ll Stay' 2",
        '-c', "set Artist 'The Artist' 2",
        '-c', "set Album 'The Album' 2",
        audioPath,
      ],
    ]);
    expect(metadataReader).toHaveBeenCalledWith(audioPath);
  });

  it('rejects metadata when the values read from the file do not match', async () => {
    const { directory, audioPath } = await fixture();
    const metadataReader: TrackMetadataReader = vi.fn(async () => ({
      title: 'Different',
      artist: 'The Artist',
      album: 'The Album',
    }));
    const adapter = new Kid3Adapter(
      path.join(directory, 'cache'),
      successfulRunner(),
      syncedLyrics(),
      'kid3-cli',
      metadataReader,
    );

    await expect(adapter.writeMetadataAndVerify(audioPath, {
      title: 'Expected',
      artist: 'The Artist',
      album: 'The Album',
    })).rejects.toMatchObject<Kid3Error>({ kind: 'verification' });
  });

  it('writes and verifies only the requested metadata field', async () => {
    const { directory, audioPath } = await fixture();
    const runner = successfulRunner();
    const metadataReader: TrackMetadataReader = vi.fn(async () => ({
      artist: 'Only Artist',
    }));
    const adapter = new Kid3Adapter(
      path.join(directory, 'cache'),
      runner,
      syncedLyrics(),
      'kid3-cli',
      metadataReader,
    );

    await adapter.writeMetadataAndVerify(audioPath, { artist: 'Only Artist' });

    expect(runner).toHaveBeenCalledWith('kid3-cli', [
      '-c', "set Artist 'Only Artist' 2",
      audioPath,
    ]);
  });

  it('writes the standard language field and verifies its readback', async () => {
    const { directory, audioPath } = await fixture();
    const runner = successfulRunner();
    const metadataReader: TrackMetadataReader = vi.fn(async () => ({ language: 'jpn' }));
    const adapter = new Kid3Adapter(
      path.join(directory, 'cache'),
      runner,
      syncedLyrics(),
      'kid3-cli',
      metadataReader,
    );

    await adapter.writeMetadataAndVerify(audioPath, { language: 'jpn' });

    expect(runner).toHaveBeenCalledWith('kid3-cli', [
      '-c', "set Language 'jpn' 2",
      audioPath,
    ]);
  });

  it('deletes an individual metadata frame when its value is empty', async () => {
    const { directory, audioPath } = await fixture();
    const runner = successfulRunner();
    const metadataReader: TrackMetadataReader = vi.fn(async () => ({}));
    const adapter = new Kid3Adapter(
      path.join(directory, 'cache'),
      runner,
      syncedLyrics(),
      'kid3-cli',
      metadataReader,
    );

    await adapter.writeMetadataAndVerify(audioPath, { album: '' });

    expect(runner).toHaveBeenCalledWith('kid3-cli', [
      '-c', "set Album '' 2",
      audioPath,
    ]);
  });

  it('writes synchronized lyrics directly and removes its temporary LRC', async () => {
    const { directory, audioPath } = await fixture();
    const cachePath = path.join(directory, 'cache');
    const adapter = new Kid3Adapter(
      cachePath,
      successfulRunner(),
      syncedLyrics([1000, 'First'], [2000, 'Second']),
    );

    await adapter.writeLyricsAndVerify(
      audioPath,
      '[00:01.00]First\n[00:02.00]Second\n',
    );

    expect(await readdir(cachePath)).toEqual([]);
  });

  it('passes file paths as arguments and accepts a matching readback', async () => {
    const { directory, audioPath, lrcPath } = await fixture();
    const runner = successfulRunner();
    const reader = syncedLyrics([1000, 'First'], [2000, 'Second']);
    const adapter = new Kid3Adapter(path.join(directory, 'cache'), runner, reader);
    await adapter.writeAndVerify(audioPath, lrcPath);
    expect(runner).toHaveBeenCalledTimes(2);
    expect(vi.mocked(runner).mock.calls[0][1].at(-1)).toBe(audioPath);
    expect(vi.mocked(runner).mock.calls[0][1].slice(0, -1)).toEqual([
      '-c', expect.stringContaining('set SYLT:'),
      '-c', 'set "SYLT.Text Encoding" 1 2',
      '-c', expect.stringContaining('set SYLT:'),
    ]);
  });

  it('accepts Unicode lyrics after normalizing Kid3 line markers', async () => {
    const { directory, audioPath, lrcPath } = await fixture();
    await writeFile(lrcPath, '[00:01.00]着迷于你眼睛\n');
    const adapter = new Kid3Adapter(
      path.join(directory, 'cache'),
      successfulRunner(),
      syncedLyrics([1000, '着迷于你眼睛']),
    );
    await expect(adapter.writeAndVerify(audioPath, lrcPath)).resolves.toBeUndefined();
  });

  it('fails when the embedded SYLT content differs', async () => {
    const { directory, audioPath, lrcPath } = await fixture();
    const adapter = new Kid3Adapter(
      path.join(directory, 'cache'),
      successfulRunner(),
      syncedLyrics([1000, 'Different']),
    );
    await expect(adapter.writeAndVerify(audioPath, lrcPath))
      .rejects.toMatchObject<Kid3Error>({ kind: 'verification' });
  });

  it('fails when Kid3 does not report UTF-16 for the SYLT frame', async () => {
    const { directory, audioPath, lrcPath } = await fixture();
    const runner: ProcessRunner = vi.fn(async () => ({ stdout: '', stderr: '' }));
    const adapter = new Kid3Adapter(
      path.join(directory, 'cache'),
      runner,
      syncedLyrics([1000, 'First'], [2000, 'Second']),
    );
    await expect(adapter.writeAndVerify(audioPath, lrcPath))
      .rejects.toMatchObject<Kid3Error>({ kind: 'verification' });
  });

  it('preserves a missing-executable error for the caller', async () => {
    const { directory, audioPath, lrcPath } = await fixture();
    const runner: ProcessRunner = async () => {
      throw new Kid3Error('not_found', 'missing');
    };
    const adapter = new Kid3Adapter(
      path.join(directory, 'cache'),
      runner,
      syncedLyrics([1000, 'First'], [2000, 'Second']),
    );
    await expect(adapter.writeAndVerify(audioPath, lrcPath))
      .rejects.toMatchObject<Kid3Error>({ kind: 'not_found' });
  });
});
