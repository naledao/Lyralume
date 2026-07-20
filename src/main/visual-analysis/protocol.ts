import type { TrackAudioProfile, TrackVisualTimeline } from '../../shared/visual-analysis.js';

export interface VisualAnalysisWorkerRequest {
  type: 'analyze';
  taskId: string;
  trackId: string;
  filePath: string;
  durationMs: number;
  sampleRate: number;
  ffmpegPath: string;
}

export interface VisualAnalysisWorkerCancel {
  type: 'cancel';
  taskId: string;
}

export type VisualAnalysisWorkerCommand = VisualAnalysisWorkerRequest | VisualAnalysisWorkerCancel;

export interface VisualAnalysisWorkerProgress {
  type: 'progress';
  taskId: string;
  progress: number;
}

export interface VisualAnalysisWorkerResult {
  type: 'result';
  taskId: string;
  fingerprint: string;
  profile: TrackAudioProfile;
  timeline: TrackVisualTimeline;
}

export interface VisualAnalysisWorkerError {
  type: 'error';
  taskId: string;
  message: string;
}

export type VisualAnalysisWorkerMessage =
  | VisualAnalysisWorkerProgress
  | VisualAnalysisWorkerResult
  | VisualAnalysisWorkerError;
