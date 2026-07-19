// @vitest-environment node

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LibraryDatabase } from '../library/database';
import type { ScannedTrack } from '../library/types';
import { TrackWriteCoordinator } from '../track-write-coordinator';
import { BilingualLyricsService, bilingualLinesToLrc } from './bilingual-lyrics-service';
import type { BilingualLyricsTranslator } from './codex-bilingual-translator';
import { Kid3Error } from './kid3';

const temporaryDirectories: string[] = [];

async function createFixture(): Promise<{
  database: LibraryDatabase;
  directory: string;
  lrcPath: string;
  track: ScannedTrack;
}> {
  const directory = await mkdtemp(path.join(tmpdir(), 'lyralume-bilingual-test-'));
  temporaryDirectories.push(directory);
  const filePath = path.join(directory, 'song.mp3');
  const lrcPath = path.join(directory, 'song.lrc');
  const track: ScannedTrack = {
    id: '0123456789abcdef01234567',
    rootPath: directory,
    filePath,
    fileName: 'song.mp3',
    title: 'Crystal Ball',
    artist: 'Lenka',
    album: 'Two',
    language: null,
    duration: 120,
    fileSize: 2_048,
    modifiedAt: 42,
    lrcPath,
    artworkMime: null,
    artwork: null,
  };
  await Promise.all([
    writeFile(filePath, ''),
    writeFile(lrcPath, '[00:01.00]First line\n[00:04.00]Second line\n'),
  ]);
  const database = new LibraryDatabase(path.join(directory, 'library.db'));
  database.syncRoot(directory, [track], new Set([filePath]));
  return { database, directory, lrcPath, track };
}

afterEach(async () => {
  for (const directory of temporaryDirectories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

describe('BilingualLyricsService', () => {
  const library = () => ({ refreshSnapshot: vi.fn() });
  const kid3 = () => ({ writeLyricsAndVerify: vi.fn(async () => undefined) });

  it('persists a review draft without modifying the source LRC', async () => {
    const { database, lrcPath, track } = await createFixture();
    const translator: BilingualLyricsTranslator = {
      translate: vi.fn(async (input, _signal, onProgress) => {
        onProgress?.('analyzing', '分析歌词');
        onProgress?.('researching', '联网研究');
        onProgress?.('translating', '中文译配');
        return {
          summary: '采用自然、有意境的表达。',
          lines: input.lines.map((line, index) => ({
            id: line.id,
            translatedText: index === 0 ? '第一行' : '第二行',
          })),
          sources: [{ title: 'Interview', url: 'https://example.com/interview' }],
        };
      }),
    };
    const listener = vi.fn();
    const service = new BilingualLyricsService(database, library(), kid3(), translator);
    service.setListener(listener);

    const task = await service.start(track.id, { style: 'lyrical' });

    expect(task).toMatchObject({
      status: 'review',
      progress: 1,
      lines: [
        { originalText: 'First line', translatedText: '第一行' },
        { originalText: 'Second line', translatedText: '第二行' },
      ],
    });
    expect(database.getBilingualLyricsTask(track.id)).toEqual(task);
    await expect(import('node:fs/promises').then(({ readFile }) => readFile(lrcPath, 'utf8')))
      .resolves.toBe('[00:01.00]First line\n[00:04.00]Second line\n');
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ status: 'researching' }));
    database.close();
  });

  it('discards a result when the source lyrics change during translation', async () => {
    const { database, lrcPath, track } = await createFixture();
    const translator: BilingualLyricsTranslator = {
      translate: vi.fn(async (input) => {
        await writeFile(lrcPath, '[00:01.00]Changed line\n');
        return {
          summary: '结果',
          lines: input.lines.map((line) => ({ id: line.id, translatedText: '翻译' })),
          sources: [{ title: 'Source', url: 'https://example.com/source' }],
        };
      }),
    };
    const service = new BilingualLyricsService(database, library(), kid3(), translator);

    await expect(service.start(track.id)).resolves.toMatchObject({
      status: 'failed',
      error: { code: 'source_changed' },
      lines: [],
    });
    database.close();
  });

  it('writes original and translated lines to MP3 SYLT and verifies the result', async () => {
    const { database, lrcPath, track } = await createFixture();
    const translator: BilingualLyricsTranslator = {
      translate: vi.fn(async (translationInput) => ({
        summary: '双语结果',
        lines: translationInput.lines.map((line, index) => ({
          id: line.id,
          translatedText: index === 0 ? '第一行' : '第二行',
        })),
        sources: [],
      })),
    };
    const libraryService = library();
    const kid3Adapter = kid3();
    const service = new BilingualLyricsService(
      database,
      libraryService,
      kid3Adapter,
      translator,
      new TrackWriteCoordinator(),
    );
    await service.start(track.id);

    const task = await service.writeTag(track.id);

    expect(task).toMatchObject({
      status: 'review',
      tagWriteStatus: 'verified',
      message: '双语同步歌词已写入 MP3 并通过回读验证',
    });
    expect(kid3Adapter.writeLyricsAndVerify).toHaveBeenCalledWith(
      track.filePath,
      '[00:01.00]First line\n[00:01.00]第一行\n[00:04.00]Second line\n[00:04.00]第二行\n',
      'Lyralume / Bilingual zh-CN',
    );
    expect(database.getTrackLocation(track.id)?.preferEmbeddedLyrics).toBe(true);
    expect(libraryService.refreshSnapshot).toHaveBeenCalledOnce();
    await expect(readFile(lrcPath, 'utf8'))
      .resolves.toBe('[00:01.00]First line\n[00:04.00]Second line\n');
    database.close();
  });

  it('keeps the bilingual draft when Kid3 verification fails', async () => {
    const { database, track } = await createFixture();
    const translator: BilingualLyricsTranslator = {
      translate: vi.fn(async (translationInput) => ({
        summary: '双语结果',
        lines: translationInput.lines.map((line) => ({ id: line.id, translatedText: '译文' })),
        sources: [],
      })),
    };
    const kid3Adapter = {
      writeLyricsAndVerify: vi.fn(async () => {
        throw new Kid3Error('verification', '回读不一致');
      }),
    };
    const service = new BilingualLyricsService(database, library(), kid3Adapter, translator);
    await service.start(track.id);

    const task = await service.writeTag(track.id);

    expect(task).toMatchObject({
      status: 'review',
      tagWriteStatus: 'failed',
      error: { code: 'verification_failed', message: '回读不一致' },
    });
    expect(task.lines).toHaveLength(2);
    database.close();
  });

  it('refuses to write a stale bilingual draft after the source lyrics change', async () => {
    const { database, lrcPath, track } = await createFixture();
    const translator: BilingualLyricsTranslator = {
      translate: vi.fn(async (translationInput) => ({
        summary: '双语结果',
        lines: translationInput.lines.map((line) => ({ id: line.id, translatedText: '译文' })),
        sources: [],
      })),
    };
    const kid3Adapter = kid3();
    const service = new BilingualLyricsService(database, library(), kid3Adapter, translator);
    await service.start(track.id);
    await writeFile(lrcPath, '[00:01.00]Changed after review\n');

    const task = await service.writeTag(track.id);

    expect(task).toMatchObject({
      status: 'review',
      tagWriteStatus: 'failed',
      error: { code: 'source_changed' },
    });
    expect(task.lines).toHaveLength(2);
    expect(kid3Adapter.writeLyricsAndVerify).not.toHaveBeenCalled();
    database.close();
  });

  it('formats bilingual rows with matching timestamps and removes unsafe line breaks', () => {
    expect(bilingualLinesToLrc([{
      id: '1',
      time: 61.239,
      originalText: 'First\nline',
      translatedText: '第一\r\n行',
    }])).toBe('[01:01.24]First line\n[01:01.24]第一 行\n');
  });
});
