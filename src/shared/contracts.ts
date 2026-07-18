export type LyricsStatus = 'idle' | 'loading' | 'loaded' | 'missing' | 'error';

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
    rescan(): Promise<ScanResult>;
    onChanged(callback: (snapshot: LibrarySnapshot) => void): () => void;
    onScanProgress(callback: (progress: ScanProgress) => void): () => void;
  };
  lyrics: {
    load(trackId: string): Promise<LyricsDocument>;
  };
  app: {
    getVersion(): Promise<string>;
  };
}

export const IPC_CHANNELS = {
  librarySnapshot: 'library:snapshot',
  libraryChooseDirectory: 'library:choose-directory',
  libraryRescan: 'library:rescan',
  libraryChanged: 'library:changed',
  libraryScanProgress: 'library:scan-progress',
  lyricsLoad: 'lyrics:load',
  appVersion: 'app:version',
} as const;
