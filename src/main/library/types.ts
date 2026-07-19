export interface ScannedTrack {
  id: string;
  rootPath: string;
  filePath: string;
  fileName: string;
  title: string;
  artist: string;
  album: string;
  duration: number;
  fileSize: number;
  modifiedAt: number;
  lrcPath: string | null;
  hasEmbeddedLyrics?: boolean;
  artworkMime: string | null;
  artwork: Buffer | null;
}

export interface StoredTrackLocation {
  id: string;
  filePath: string;
  lrcPath: string | null;
  preferEmbeddedLyrics: boolean;
  title: string;
  artist: string;
  album: string;
  duration: number;
}

export interface StoredArtwork {
  mime: string;
  data: Buffer;
}
