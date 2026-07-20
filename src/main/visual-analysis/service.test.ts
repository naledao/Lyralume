// @vitest-environment node

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  AUDIO_ANALYSIS_VERSION,
  VISUAL_MAPPING_VERSION,
  createFallbackProfile,
  createVisualDNA,
} from '../../shared/visual-analysis';
import { LibraryDatabase } from '../library/database';
import type { ScannedTrack } from '../library/types';
import type {
  VisualAnalysisRunRequest,
  VisualAnalysisRunResult,
  VisualAnalysisRunner,
} from './runner';
import { VisualAnalysisService } from './service';

const temporaryDirectories: string[] = [];

class FakeRunner implements VisualAnalysisRunner {
  requests: VisualAnalysisRunRequest[] = [];

  async analyze(
    request: VisualAnalysisRunRequest,
    onProgress: (progress: number) => void,
  ): Promise<VisualAnalysisRunResult> {
    this.requests.push(request);
    onProgress(0.5);
    return {
      fingerprint: 'audio-content-fingerprint',
      profile: createFallbackProfile(),
      timeline: { beatsMs: [0, 500, 1_000], sections: [] },
    };
  }

  async close(): Promise<void> {}
}

function scannedTrack(rootPath: string, filePath: string): ScannedTrack {
  return {
    id: '0123456789abcdef01234567',
    rootPath,
    filePath,
    fileName: 'track.flac',
    title: 'Track',
    artist: 'Artist',
    album: 'Album',
    language: null,
    duration: 60,
    fileSize: 123,
    modifiedAt: 456,
    lrcPath: null,
    artworkMime: null,
    artwork: null,
  };
}

afterEach(async () => {
  for (const directory of temporaryDirectories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

describe('VisualAnalysisService', () => {
  it('remaps a current cached profile without decoding the song again', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'lyralume-visual-remap-test-'));
    temporaryDirectories.push(directory);
    const database = new LibraryDatabase(path.join(directory, 'library.db'));
    const track = scannedTrack(directory, path.join(directory, 'track.flac'));
    database.syncRoot(directory, [track], new Set([track.filePath]));
    const profile = createFallbackProfile();
    database.saveVisualAnalysis({
      trackId: track.id,
      status: 'ready',
      progress: 1,
      analysisVersion: AUDIO_ANALYSIS_VERSION,
      mappingVersion: VISUAL_MAPPING_VERSION - 1,
      sourceSize: track.fileSize,
      sourceModifiedAt: track.modifiedAt,
      contentFingerprint: 'cached-fingerprint',
      profile,
      timeline: { beatsMs: [], sections: [] },
      visualDNA: createVisualDNA(profile, 'old-mapping'),
      updatedAt: 1,
    });
    const runner = new FakeRunner();
    const service = new VisualAnalysisService(database, runner);

    expect(service.get(track.id)).toMatchObject({
      status: 'ready',
      mappingVersion: VISUAL_MAPPING_VERSION,
      visualDNA: expect.objectContaining({ mappingVersion: VISUAL_MAPPING_VERSION }),
    });
    expect(runner.requests).toHaveLength(0);

    await service.close();
    database.close();
  });

  it('analyzes a queued track and stores its content-derived visual DNA', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'lyralume-visual-test-'));
    temporaryDirectories.push(directory);
    const database = new LibraryDatabase(path.join(directory, 'library.db'));
    const filePath = path.join(directory, 'track.flac');
    const track = scannedTrack(directory, filePath);
    database.syncRoot(directory, [track], new Set([filePath]));
    const runner = new FakeRunner();
    const service = new VisualAnalysisService(database, runner);
    const completed = new Promise<void>((resolve) => {
      service.setListeners((analysis) => {
        if (analysis.status === 'ready') resolve();
      }, () => undefined);
    });

    service.scheduleLibrary(database.getSnapshot().tracks);
    await completed;

    expect(runner.requests).toEqual([
      expect.objectContaining({ trackId: track.id, filePath, durationMs: 60_000 }),
    ]);
    expect(database.getVisualAnalysis(track.id)).toMatchObject({
      status: 'ready',
      contentFingerprint: 'audio-content-fingerprint',
      visualDNA: expect.objectContaining({ mappingVersion: VISUAL_MAPPING_VERSION }),
    });
    await service.close();
    database.close();
  });
});
