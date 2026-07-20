// @vitest-environment node

import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LocalLyricsTask } from '../../shared/contracts';
import { LibraryDatabase } from '../library/database';
import { LibraryService } from '../library/service';
import type { ScannedTrack } from '../library/types';
import { Kid3Adapter } from '../lyrics/kid3';
import { TrackWriteCoordinator } from '../track-write-coordinator';
import type { LocalLyricsProofreader } from './codex-proofreader';
import { LocalLyricsService } from './local-lyrics-service';
import type { LocalLyricsWorkerGateway } from './worker-gateway';
import type { SeparationWorkerRequest, TranscriptionWorkerRequest, WorkerProgressMessage, WorkerResultMessage } from './worker-protocol';
import { WorkerExecutionError } from './worker-process';

const temporaryDirectories: string[] = [];
const openResources: Array<{ service: LocalLyricsService; database: LibraryDatabase }> = [];

function track(rootPath: string, filePath: string, id = '0123456789abcdef01234567'): ScannedTrack {
  return {
    id,
    rootPath,
    filePath,
    fileName: path.basename(filePath),
    title: 'Track',
    artist: 'Artist',
    album: 'Album',
    language: null,
    duration: 30,
    fileSize: 5,
    modifiedAt: 1,
    lrcPath: null,
    artworkMime: null,
    artwork: null,
  };
}

function result(
  request: SeparationWorkerRequest | TranscriptionWorkerRequest,
  stage: 'separation' | 'alignment',
  outputs: Record<string, string>,
): WorkerResultMessage {
  return { version: 1, type: 'result', taskId: request.taskId, stage, outputs };
}

function successfulWorkers(order: string[] = []): LocalLyricsWorkerGateway {
  return {
    separate: vi.fn(async (
      request: SeparationWorkerRequest,
      _signal: AbortSignal,
      onProgress: (message: WorkerProgressMessage) => void,
    ) => {
      order.push('uvr:start');
      onProgress({
        version: 1,
        type: 'progress',
        taskId: request.taskId,
        stage: 'separation',
        progress: 0.5,
        message: 'separating',
      });
      await writeFile(request.outputPath, 'temporary vocals');
      order.push('uvr:exit');
      return result(request, 'separation', { vocalsPath: request.outputPath });
    }),
    transcribe: vi.fn(async (
      request: TranscriptionWorkerRequest,
      _signal: AbortSignal,
      onProgress: (message: WorkerProgressMessage) => void,
    ) => {
      order.push('whisper:start');
      onProgress({
        version: 1,
        type: 'progress',
        taskId: request.taskId,
        stage: 'alignment',
        progress: 0.75,
        message: 'aligning',
      });
      await writeFile(request.transcriptPath, JSON.stringify({
        language: 'zh',
        segments: [{ text: '你好世界。' }],
      }));
      await writeFile(request.alignmentPath, JSON.stringify({
        language: 'zh',
        segments: [{
          text: '你好世界。',
          start: 1,
          end: 2,
          words: [
            { word: '你好', start: 1, end: 1.4, score: 0.95 },
            { word: '世界。', start: 1.4, end: 2, score: 0.9 },
          ],
        }],
      }));
      order.push('whisper:exit');
      return { ...result(request, 'alignment', {
        transcriptPath: request.transcriptPath,
        alignmentPath: request.alignmentPath,
      }), language: 'zh' };
    }),
  };
}

async function fixture(
  workers: LocalLyricsWorkerGateway = successfulWorkers(),
  proofreader?: LocalLyricsProofreader,
) {
  const directory = await mkdtemp(path.join(tmpdir(), 'lyralume-local-lyrics-'));
  temporaryDirectories.push(directory);
  const audioPath = path.join(directory, 'song.flac');
  await writeFile(audioPath, 'audio');
  const database = new LibraryDatabase(path.join(directory, 'library.db'));
  const scanned = track(directory, audioPath);
  database.syncRoot(directory, [scanned], new Set([audioPath]));
  const library = new LibraryService(database);
  const service = new LocalLyricsService(
    database,
    library,
    workers,
    new Kid3Adapter(path.join(directory, 'kid3-cache')),
    {
      cacheRoot: path.join(directory, 'task-cache'),
      modelRoot: path.join(directory, 'models'),
      defaultDevice: 'cpu',
    },
    new TrackWriteCoordinator(),
    proofreader,
  );
  openResources.push({ service, database });
  return { directory, audioPath, database, service, trackId: scanned.id };
}

function waitForStatus(
  service: LocalLyricsService,
  status: LocalLyricsTask['status'],
): Promise<LocalLyricsTask> {
  return new Promise((resolve) => {
    service.setListener((task) => {
      if (task.status === status) resolve(task);
    });
  });
}

afterEach(async () => {
  for (const resource of openResources.splice(0)) {
    await resource.service.close();
    resource.database.close();
  }
  for (const directory of temporaryDirectories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

describe('LocalLyricsService', () => {
  it('uses the saved track language with the WhisperX language code', async () => {
    const workers = successfulWorkers();
    const context = await fixture(workers);
    expect(context.database.setTrackMetadata(context.trackId, { language: 'zho' })).toBe(true);
    const ready = waitForStatus(context.service, 'review');

    const started = await context.service.start(context.trackId, { device: 'cpu' });
    await ready;
    await context.service.close();

    expect(started.language).toBe('zh');
    expect(workers.transcribe).toHaveBeenCalledWith(
      expect.objectContaining({ language: 'zh' }),
      expect.any(AbortSignal),
      expect.any(Function),
    );
  });

  it('keeps an explicitly requested WhisperX language ahead of track metadata', async () => {
    const workers = successfulWorkers();
    const context = await fixture(workers);
    expect(context.database.setTrackMetadata(context.trackId, { language: 'zho' })).toBe(true);
    const ready = waitForStatus(context.service, 'review');

    const started = await context.service.start(context.trackId, {
      device: 'cpu',
      language: 'en',
    });
    await ready;
    await context.service.close();

    expect(started.language).toBe('en');
    expect(workers.transcribe).toHaveBeenCalledWith(
      expect.objectContaining({ language: 'en' }),
      expect.any(AbortSignal),
      expect.any(Function),
    );
  });

  it('passes a user-selected UVR model to the worker as an external read-only file', async () => {
    const workers = successfulWorkers();
    const context = await fixture(workers);
    const customModel = path.join(context.directory, 'downloads', 'my-model.ckpt');
    await mkdir(path.dirname(customModel), { recursive: true });
    await writeFile(customModel, 'user-owned-model');
    await context.service.setCustomUvrModel(customModel);
    const ready = waitForStatus(context.service, 'review');
    await context.service.start(context.trackId, { device: 'cpu' });
    await ready;
    await context.service.close();

    expect(workers.separate).toHaveBeenCalledWith(
      expect.objectContaining({
        modelDirectory: path.dirname(customModel),
        modelName: path.basename(customModel),
        modelSource: 'external',
      }),
      expect.any(AbortSignal),
      expect.any(Function),
    );
    await expect(readFile(customModel, 'utf8')).resolves.toBe('user-owned-model');
  });

  it('runs UVR before WhisperX and creates all review artifacts without changing the source', async () => {
    const order: string[] = [];
    const context = await fixture(successfulWorkers(order));
    const ready = waitForStatus(context.service, 'review');
    const started = await context.service.start(context.trackId, { device: 'cpu' });
    const task = await ready;
    await context.service.close();

    expect(order).toEqual(['uvr:start', 'uvr:exit', 'whisper:start', 'whisper:exit']);
    expect(task).toMatchObject({
      id: started.id,
      status: 'review',
      language: 'zh',
      lowConfidenceCount: 0,
      draftLines: [{ text: '你好世界。', flags: [] }],
    });
    const taskDirectory = path.join(context.directory, 'task-cache', task.id);
    await expect(readFile(path.join(taskDirectory, 'vocals.wav'), 'utf8')).resolves.toBe('temporary vocals');
    await expect(readFile(path.join(taskDirectory, 'raw-transcript.json'), 'utf8')).resolves.toContain('你好世界');
    await expect(readFile(path.join(taskDirectory, 'alignment.json'), 'utf8')).resolves.toContain('score');
    await expect(readFile(path.join(taskDirectory, 'draft.json'), 'utf8')).resolves.toContain('"lines"');
    await expect(readFile(path.join(taskDirectory, 'draft.lrc'), 'utf8')).resolves.toContain('[00:01.00]你好世界。');
    const manifest = JSON.parse(await readFile(path.join(taskDirectory, 'manifest.json'), 'utf8'));
    expect(manifest.task.status).toBe('review');
    await expect(readFile(context.audioPath, 'utf8')).resolves.toBe('audio');
  });

  it('accepts Codex line restructuring and timing suggestions without saving them', async () => {
    const proofreader: LocalLyricsProofreader = {
      proofread: vi.fn(async (_input, _signal, onProgress) => {
        onProgress?.({
          stage: 'searching',
          message: '联网检索完成',
          detail: 'Track Artist lyrics',
        });
        return {
          summary: '拆为两行并调整整体偏移',
          offsetMs: 500,
          lines: [
            { id: 'codex-1', startTime: 1, endTime: 1.5, text: '你好，' },
            { id: 'codex-2', startTime: 1.5, endTime: 2, text: '世界。' },
          ],
          sources: [{ title: '公开歌曲资料', url: 'https://example.com/song' }],
        };
      }),
    };
    const context = await fixture(successfulWorkers(), proofreader);
    const ready = waitForStatus(context.service, 'review');
    await context.service.start(context.trackId, { device: 'cpu' });
    const task = await ready;

    const progress = vi.fn();
    const result = await context.service.proofread(context.trackId, {
      lines: task.draftLines,
      offsetMs: task.draftOffsetMs,
    }, progress);

    expect(proofreader.proofread).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Track',
        offsetMs: 0,
        lines: [expect.objectContaining({
          id: task.draftLines[0].id,
          startTime: 1,
          endTime: 2,
          text: '你好世界。',
        })],
      }),
      expect.any(AbortSignal),
      expect.any(Function),
    );
    expect(result).toMatchObject({
      changedLineCount: 3,
      offsetMs: 500,
      sources: [{ title: '公开歌曲资料', url: 'https://example.com/song' }],
      lines: [
        expect.objectContaining({
          id: 'codex-1',
          text: '你好，',
          startTime: 1,
          endTime: 1.5,
          confidence: null,
          flags: ['low_confidence'],
        }),
        expect.objectContaining({
          id: 'codex-2',
          text: '世界。',
          startTime: 1.5,
          endTime: 2,
          confidence: null,
          flags: ['low_confidence'],
        }),
      ],
    });
    expect(progress).toHaveBeenCalledWith(expect.objectContaining({
      trackId: context.trackId,
      stage: 'searching',
      detail: 'Track Artist lyrics',
    }));
    expect(progress).toHaveBeenLastCalledWith(expect.objectContaining({
      stage: 'completed',
      message: 'Codex 校对建议已通过验证',
    }));
    expect(context.service.getTask(context.trackId).draftLines[0].text).toBe('你好世界。');
  });

  it('keeps the completed vocals artifact when transcription fails', async () => {
    const workers = successfulWorkers();
    workers.transcribe = vi.fn(async () => {
      throw new WorkerExecutionError('worker', 'WhisperX crashed');
    });
    const context = await fixture(workers);
    const failed = waitForStatus(context.service, 'failed');
    const started = await context.service.start(context.trackId, { device: 'cpu' });
    const task = await failed;
    await context.service.close();

    expect(task.error).toMatchObject({ code: 'worker_failed', message: 'WhisperX crashed' });
    await expect(readFile(path.join(context.directory, 'task-cache', started.id, 'vocals.wav'), 'utf8'))
      .resolves.toBe('temporary vocals');
    const manifest = JSON.parse(await readFile(
      path.join(context.directory, 'task-cache', started.id, 'manifest.json'),
      'utf8',
    ));
    expect(manifest.task.status).toBe('failed');
  });

  it('does not overwrite an existing LRC until the user explicitly confirms overwrite', async () => {
    const context = await fixture();
    const ready = waitForStatus(context.service, 'review');
    await context.service.start(context.trackId, { device: 'cpu' });
    const task = await ready;
    const existingPath = path.join(context.directory, 'song.lrc');
    await writeFile(existingPath, '[00:00.00]existing\n');
    const update = { lines: task.draftLines, offsetMs: 0 };

    const protectedResult = await context.service.confirmLrc(context.trackId, update);
    expect(protectedResult.error?.code).toBe('existing_lrc');
    await expect(readFile(existingPath, 'utf8')).resolves.toBe('[00:00.00]existing\n');

    const overwritten = await context.service.confirmLrc(context.trackId, update, true);
    expect(overwritten.lrcSaveStatus).toBe('saved');
    await expect(readFile(existingPath, 'utf8')).resolves.toBe('[00:01.00]你好世界。\n');
  });
});
