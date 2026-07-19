import type { TrackLanguage } from './track-language.js';

export {
  getTrackLanguageLabel,
  isTrackLanguage,
  normalizeTrackLanguage,
  TRACK_LANGUAGE_OPTIONS,
} from './track-language.js';
export type { TrackLanguage } from './track-language.js';

export type LyricsStatus = 'idle' | 'loading' | 'loaded' | 'missing' | 'error';

export type OnlineLyricsTaskStatus =
  | 'idle'
  | 'querying'
  | 'awaiting_confirmation'
  | 'saving'
  | 'saved'
  | 'writing_tag'
  | 'completed'
  | 'failed';

export type OnlineLyricsErrorCode =
  | 'invalid_request'
  | 'track_not_found'
  | 'network_error'
  | 'service_error'
  | 'no_match'
  | 'missing_synced_lyrics'
  | 'candidate_not_found'
  | 'existing_lrc'
  | 'invalid_lrc'
  | 'save_failed'
  | 'write_in_progress'
  | 'task_interrupted'
  | 'kid3_not_found'
  | 'kid3_failed'
  | 'verification_failed';

export interface OnlineLyricsCandidate {
  id: number;
  trackName: string;
  artistName: string;
  albumName: string;
  duration: number;
  instrumental: boolean;
  syncedLyrics: string;
  preview: string;
  score: number;
  durationDelta: number;
  confidence: 'high' | 'medium' | 'low';
  recommended: boolean;
}

export interface OnlineLyricsTaskError {
  code: OnlineLyricsErrorCode;
  message: string;
}

export interface OnlineLyricsTask {
  id: string;
  trackId: string;
  status: OnlineLyricsTaskStatus;
  source: 'lrclib';
  candidates: OnlineLyricsCandidate[];
  selectedCandidateId?: number;
  lrcFileName?: string;
  lrcSaveStatus: 'not_started' | 'saving' | 'saved' | 'failed';
  tagWriteStatus: 'not_started' | 'writing' | 'verified' | 'failed';
  error?: OnlineLyricsTaskError;
  updatedAt: number;
}

export type LocalLyricsTaskStatus =
  | 'idle'
  | 'queued'
  | 'separating'
  | 'transcribing'
  | 'compiling'
  | 'review'
  | 'saving_draft'
  | 'saving_lrc'
  | 'lrc_saved'
  | 'writing_tag'
  | 'completed'
  | 'cancelled'
  | 'failed';

export type LocalLyricsStage =
  | 'pending'
  | 'separation'
  | 'transcription'
  | 'alignment'
  | 'draft'
  | 'confirmation';

export type LocalLyricsErrorCode =
  | 'invalid_request'
  | 'track_not_found'
  | 'task_in_progress'
  | 'worker_not_configured'
  | 'worker_start_failed'
  | 'worker_protocol_error'
  | 'worker_failed'
  | 'invalid_alignment'
  | 'invalid_draft'
  | 'existing_lrc'
  | 'save_failed'
  | 'write_in_progress'
  | 'kid3_not_found'
  | 'kid3_failed'
  | 'verification_failed'
  | 'task_interrupted';

export type LocalLyricsLineFlag = 'low_confidence' | 'missing_timing';

export interface LocalLyricsDraftLine {
  id: string;
  startTime: number;
  endTime: number;
  text: string;
  confidence: number | null;
  flags: LocalLyricsLineFlag[];
}

export interface LocalLyricsTaskError {
  code: LocalLyricsErrorCode;
  message: string;
  stage?: LocalLyricsStage;
}

export interface LocalLyricsTask {
  id: string;
  trackId: string;
  status: LocalLyricsTaskStatus;
  stage: LocalLyricsStage;
  progress: number;
  message: string;
  language?: string;
  draftLines: LocalLyricsDraftLine[];
  draftOffsetMs: number;
  lowConfidenceCount: number;
  vocalsPlaybackUrl?: string;
  lrcFileName?: string;
  lrcSaveStatus: 'not_started' | 'saving' | 'saved' | 'failed';
  tagWriteStatus: 'not_started' | 'writing' | 'verified' | 'failed';
  error?: LocalLyricsTaskError;
  createdAt: number;
  updatedAt: number;
}

export interface LocalLyricsStartOptions {
  language?: string;
  device?: 'cuda' | 'cpu';
}

export interface LocalLyricsModelSettings {
  uvrModelSource: 'managed' | 'custom';
  uvrModelPath: string;
  uvrModelName: string;
  uvrModelAvailable: boolean;
}

export interface LocalLyricsDraftUpdate {
  lines: LocalLyricsDraftLine[];
  offsetMs: number;
}

export interface LocalLyricsProofreadResult {
  lines: LocalLyricsDraftLine[];
  offsetMs: number;
  changedLineCount: number;
  summary: string;
  sources: Array<{ title: string; url: string }>;
}

export type LocalLyricsProofreadProgressStage =
  | 'preparing'
  | 'starting'
  | 'connected'
  | 'searching'
  | 'analyzing'
  | 'validating'
  | 'completed'
  | 'failed';

export interface LocalLyricsProofreadProgress {
  trackId: string;
  stage: LocalLyricsProofreadProgressStage;
  message: string;
  detail?: string;
  elapsedMs: number;
  timestamp: number;
}

export type BilingualLyricsTaskStatus =
  | 'idle'
  | 'analyzing'
  | 'researching'
  | 'translating'
  | 'review'
  | 'cancelled'
  | 'failed';

export type BilingualLyricsTranslationStyle = 'natural' | 'lyrical' | 'singable';

export type BilingualLyricsErrorCode =
  | 'invalid_request'
  | 'track_not_found'
  | 'lyrics_missing'
  | 'invalid_lrc'
  | 'task_in_progress'
  | 'codex_unavailable'
  | 'codex_failed'
  | 'invalid_response'
  | 'source_changed'
  | 'write_in_progress'
  | 'kid3_not_found'
  | 'kid3_failed'
  | 'verification_failed'
  | 'task_interrupted'
  | 'cancelled';

export interface BilingualLyricsTaskError {
  code: BilingualLyricsErrorCode;
  message: string;
}

export interface BilingualLyricsSource {
  title: string;
  url: string;
}

export interface BilingualLyricsLine {
  id: string;
  time: number;
  originalText: string;
  translatedText: string;
}

export interface BilingualLyricsTask {
  id: string;
  trackId: string;
  status: BilingualLyricsTaskStatus;
  progress: number;
  message: string;
  targetLanguage: 'zh-CN';
  style: BilingualLyricsTranslationStyle;
  sourceRevision?: string;
  lines: BilingualLyricsLine[];
  summary?: string;
  sources: BilingualLyricsSource[];
  tagWriteStatus: 'not_started' | 'writing' | 'verified' | 'failed';
  error?: BilingualLyricsTaskError;
  createdAt: number;
  updatedAt: number;
}

export interface BilingualLyricsStartOptions {
  style?: BilingualLyricsTranslationStyle;
}

export interface TrackMetadata {
  title: string;
  artist: string;
  album: string;
  language: TrackLanguage | '';
}

export type TrackMetadataUpdate = Partial<TrackMetadata>;

export const UNKNOWN_ARTIST = '未知艺术家';
export const UNKNOWN_ALBUM = '未知专辑';

export interface Track {
  id: string;
  fileName: string;
  title: string;
  artist: string;
  album: string;
  language: TrackLanguage | null;
  duration: number;
  fileSize: number;
  modifiedAt: number;
  hasLyrics: boolean;
  hasArtwork: boolean;
  playbackUrl: string;
  artworkUrl?: string;
}

export interface LibraryRoot {
  path: string;
  addedAt: number;
}

export interface LibrarySnapshot {
  tracks: Track[];
  roots: LibraryRoot[];
}

export type PlaybackCheckpointReason =
  | 'periodic'
  | 'track-selected'
  | 'track-switch'
  | 'pause'
  | 'seek'
  | 'file-operation'
  | 'app-hidden'
  | 'app-close'
  | 'ended';

export interface PlaybackCheckpoint {
  trackId: string;
  positionMs: number;
  durationMs: number;
  completed: boolean;
  reason: PlaybackCheckpointReason;
}

export interface PlaybackProgress extends PlaybackCheckpoint {
  updatedAt: number;
}

export interface PlaybackStateSnapshot {
  lastTrackId: string | null;
  progress: PlaybackProgress[];
}

export interface ScanWarning {
  fileName: string;
  message: string;
}

export interface ScanResult extends LibrarySnapshot {
  scannedFiles: number;
  importedTracks: number;
  warnings: ScanWarning[];
}

export interface ScanProgress {
  rootPath: string;
  processed: number;
  total: number;
  currentFile?: string;
  completed?: boolean;
}

export interface LyricsDocument {
  status: 'loaded' | 'missing' | 'error';
  raw?: string;
  fileName?: string;
  source?: 'lrc' | 'embedded';
  revision?: string;
  message?: string;
}

export interface LyricsTimingWriteResult {
  appliedOffsetMs: number;
  lineCount: number;
  source: 'lrc' | 'embedded';
}

export interface LyralumeApi {
  library: {
    getSnapshot(): Promise<LibrarySnapshot>;
    chooseDirectory(): Promise<ScanResult | null>;
    importDropped(files: File[]): Promise<ScanResult>;
    updateMetadata(trackId: string, metadata: TrackMetadataUpdate): Promise<LibrarySnapshot>;
    removeTrack(trackId: string): Promise<LibrarySnapshot>;
    rescan(): Promise<ScanResult>;
    onChanged(callback: (snapshot: LibrarySnapshot) => void): () => void;
    onScanProgress(callback: (progress: ScanProgress) => void): () => void;
  };
  playback: {
    getState(): Promise<PlaybackStateSnapshot>;
    saveCheckpoint(checkpoint: PlaybackCheckpoint): Promise<PlaybackProgress>;
  };
  lyrics: {
    load(trackId: string): Promise<LyricsDocument>;
    writeAdjustedTiming(
      trackId: string,
      offsetMs: number,
      sourceRevision: string,
    ): Promise<LyricsTimingWriteResult>;
    getOnlineTask(trackId: string): Promise<OnlineLyricsTask>;
    searchOnline(trackId: string): Promise<OnlineLyricsTask>;
    saveOnline(trackId: string, candidateId: number, overwriteExisting?: boolean): Promise<OnlineLyricsTask>;
    writeTag(trackId: string, candidateId?: number): Promise<OnlineLyricsTask>;
    getLocalTask(trackId: string): Promise<LocalLyricsTask>;
    getLocalModelSettings(): Promise<LocalLyricsModelSettings>;
    chooseLocalUvrModel(): Promise<LocalLyricsModelSettings | null>;
    resetLocalUvrModel(): Promise<LocalLyricsModelSettings>;
    startLocal(trackId: string, options?: LocalLyricsStartOptions): Promise<LocalLyricsTask>;
    cancelLocal(trackId: string): Promise<LocalLyricsTask>;
    proofreadLocal(
      trackId: string,
      update: LocalLyricsDraftUpdate,
    ): Promise<LocalLyricsProofreadResult>;
    saveLocalDraft(trackId: string, update: LocalLyricsDraftUpdate): Promise<LocalLyricsTask>;
    confirmLocalLrc(
      trackId: string,
      update: LocalLyricsDraftUpdate,
      overwriteExisting?: boolean,
    ): Promise<LocalLyricsTask>;
    writeLocalTag(trackId: string, update: LocalLyricsDraftUpdate): Promise<LocalLyricsTask>;
    onLocalTaskChanged(callback: (task: LocalLyricsTask) => void): () => void;
    onLocalProofreadProgress(
      callback: (progress: LocalLyricsProofreadProgress) => void,
    ): () => void;
    getBilingualTask(trackId: string): Promise<BilingualLyricsTask>;
    startBilingual(
      trackId: string,
      options?: BilingualLyricsStartOptions,
    ): Promise<BilingualLyricsTask>;
    cancelBilingual(trackId: string): Promise<BilingualLyricsTask>;
    writeBilingualTag(trackId: string): Promise<BilingualLyricsTask>;
    onBilingualTaskChanged(callback: (task: BilingualLyricsTask) => void): () => void;
  };
  app: {
    getVersion(): Promise<string>;
    onPlaybackFlushRequested(callback: (requestId: string) => void): () => void;
    completePlaybackFlush(requestId: string): void;
  };
}

export const IPC_CHANNELS = {
  librarySnapshot: 'library:snapshot',
  libraryChooseDirectory: 'library:choose-directory',
  libraryImportDropped: 'library:import-dropped',
  libraryUpdateMetadata: 'library:update-metadata',
  libraryRemoveTrack: 'library:remove-track',
  libraryRescan: 'library:rescan',
  libraryChanged: 'library:changed',
  libraryScanProgress: 'library:scan-progress',
  playbackState: 'playback:state',
  playbackCheckpoint: 'playback:checkpoint',
  playbackFlushRequested: 'playback:flush-requested',
  playbackFlushComplete: 'playback:flush-complete',
  lyricsLoad: 'lyrics:load',
  lyricsWriteAdjustedTiming: 'lyrics:write-adjusted-timing',
  lyricsOnlineTask: 'lyrics:online-task',
  lyricsOnlineSearch: 'lyrics:online-search',
  lyricsOnlineSave: 'lyrics:online-save',
  lyricsWriteTag: 'lyrics:write-tag',
  lyricsLocalTask: 'lyrics:local-task',
  lyricsLocalModelSettings: 'lyrics:local-model-settings',
  lyricsLocalChooseUvrModel: 'lyrics:local-choose-uvr-model',
  lyricsLocalResetUvrModel: 'lyrics:local-reset-uvr-model',
  lyricsLocalStart: 'lyrics:local-start',
  lyricsLocalCancel: 'lyrics:local-cancel',
  lyricsLocalProofread: 'lyrics:local-proofread',
  lyricsLocalSaveDraft: 'lyrics:local-save-draft',
  lyricsLocalConfirmLrc: 'lyrics:local-confirm-lrc',
  lyricsLocalWriteTag: 'lyrics:local-write-tag',
  lyricsLocalChanged: 'lyrics:local-changed',
  lyricsLocalProofreadProgress: 'lyrics:local-proofread-progress',
  lyricsBilingualTask: 'lyrics:bilingual-task',
  lyricsBilingualStart: 'lyrics:bilingual-start',
  lyricsBilingualCancel: 'lyrics:bilingual-cancel',
  lyricsBilingualWriteTag: 'lyrics:bilingual-write-tag',
  lyricsBilingualChanged: 'lyrics:bilingual-changed',
  appVersion: 'app:version',
} as const;
