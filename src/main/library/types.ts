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
  artworkMime: string | null;
  artwork: Buffer | null;
}

export interface StoredTrackLocation {
  id: string;
  filePath: string;
  lrcPath: string | null;
}

export interface StoredArtwork {
  mime: string;
  data: Buffer;
}
