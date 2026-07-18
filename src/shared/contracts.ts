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

export interface TrackMetadata {
  title: string;
  artist: string;
  album: string;
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
  message?: string;
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
  lyrics: {
    load(trackId: string): Promise<LyricsDocument>;
    getOnlineTask(trackId: string): Promise<OnlineLyricsTask>;
    searchOnline(trackId: string): Promise<OnlineLyricsTask>;
    saveOnline(trackId: string, candidateId: number, overwriteExisting?: boolean): Promise<OnlineLyricsTask>;
    writeTag(trackId: string, candidateId?: number): Promise<OnlineLyricsTask>;
  };
  app: {
    getVersion(): Promise<string>;
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
  lyricsLoad: 'lyrics:load',
  lyricsOnlineTask: 'lyrics:online-task',
  lyricsOnlineSearch: 'lyrics:online-search',
  lyricsOnlineSave: 'lyrics:online-save',
  lyricsWriteTag: 'lyrics:write-tag',
  appVersion: 'app:version',
} as const;
