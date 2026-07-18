import Database from 'better-sqlite3';
import type { LibraryRoot, LibrarySnapshot, Track } from '../../shared/contracts.js';
import type { ScannedTrack, StoredArtwork, StoredTrackLocation } from './types.js';

interface TrackRow {
  id: string;
  file_name: string;
  title: string;
  artist: string;
  album: string;
  duration: number;
  file_size: number;
  modified_at: number;
  lrc_path: string | null;
  artwork_mime: string | null;
}

interface RootRow {
  path: string;
  added_at: number;
}

export class LibraryDatabase {
  private readonly database: Database.Database;

  constructor(databasePath: string) {
    this.database = new Database(databasePath);
    this.database.pragma('journal_mode = WAL');
    this.database.pragma('foreign_keys = ON');
    this.database.pragma('busy_timeout = 5000');
    this.migrate();
  }

  private migrate(): void {
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS library_roots (
        path TEXT PRIMARY KEY,
        added_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS tracks (
        id TEXT PRIMARY KEY,
        root_path TEXT NOT NULL,
        file_path TEXT NOT NULL UNIQUE,
        file_name TEXT NOT NULL,
        title TEXT NOT NULL,
        artist TEXT NOT NULL,
        album TEXT NOT NULL,
        duration REAL NOT NULL DEFAULT 0,
        file_size INTEGER NOT NULL,
        modified_at INTEGER NOT NULL,
        lrc_path TEXT,
        artwork_mime TEXT,
        artwork BLOB,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (root_path) REFERENCES library_roots(path) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_tracks_title ON tracks(title COLLATE NOCASE);
      CREATE INDEX IF NOT EXISTS idx_tracks_artist ON tracks(artist COLLATE NOCASE);
      CREATE INDEX IF NOT EXISTS idx_tracks_root ON tracks(root_path);
    `);
  }

  addRoot(rootPath: string): void {
    this.database
      .prepare(
        `INSERT INTO library_roots(path, added_at) VALUES (?, ?)
         ON CONFLICT(path) DO NOTHING`,
      )
      .run(rootPath, Date.now());
  }

  getRoots(): LibraryRoot[] {
    const rows = this.database
      .prepare('SELECT path, added_at FROM library_roots ORDER BY added_at ASC')
      .all() as RootRow[];
    return rows.map((row) => ({ path: row.path, addedAt: row.added_at }));
  }

  syncRoot(rootPath: string, tracks: ScannedTrack[], discoveredPaths: Set<string>): void {
    const upsert = this.database.prepare(`
      INSERT INTO tracks (
        id, root_path, file_path, file_name, title, artist, album, duration,
        file_size, modified_at, lrc_path, artwork_mime, artwork, updated_at
      ) VALUES (
        @id, @rootPath, @filePath, @fileName, @title, @artist, @album, @duration,
        @fileSize, @modifiedAt, @lrcPath, @artworkMime, @artwork, @updatedAt
      )
      ON CONFLICT(file_path) DO UPDATE SET
        root_path = excluded.root_path,
        file_name = excluded.file_name,
        title = excluded.title,
        artist = excluded.artist,
        album = excluded.album,
        duration = excluded.duration,
        file_size = excluded.file_size,
        modified_at = excluded.modified_at,
        lrc_path = excluded.lrc_path,
        artwork_mime = excluded.artwork_mime,
        artwork = excluded.artwork,
        updated_at = excluded.updated_at
    `);
    const existing = this.database.prepare('SELECT file_path FROM tracks WHERE root_path = ?');
    const remove = this.database.prepare('DELETE FROM tracks WHERE root_path = ? AND file_path = ?');

    this.database.transaction(() => {
      this.addRoot(rootPath);
      const updatedAt = Date.now();
      for (const track of tracks) upsert.run({ ...track, updatedAt });
      const existingRows = existing.all(rootPath) as Array<{ file_path: string }>;
      for (const row of existingRows) {
        if (!discoveredPaths.has(row.file_path)) remove.run(rootPath, row.file_path);
      }
    })();
  }

  getSnapshot(): LibrarySnapshot {
    const rows = this.database
      .prepare(
        `SELECT id, file_name, title, artist, album, duration, file_size,
                modified_at, lrc_path, artwork_mime
         FROM tracks
         ORDER BY artist COLLATE NOCASE, album COLLATE NOCASE, title COLLATE NOCASE`,
      )
      .all() as TrackRow[];

    return {
      tracks: rows.map((row) => this.toTrack(row)),
      roots: this.getRoots(),
    };
  }

  private toTrack(row: TrackRow): Track {
    return {
      id: row.id,
      fileName: row.file_name,
      title: row.title,
      artist: row.artist,
      album: row.album,
      duration: row.duration,
      fileSize: row.file_size,
      modifiedAt: row.modified_at,
      hasLyrics: Boolean(row.lrc_path),
      hasArtwork: Boolean(row.artwork_mime),
      playbackUrl: `lyralume-media://track/${row.id}`,
      artworkUrl: row.artwork_mime ? `lyralume-media://artwork/${row.id}` : undefined,
    };
  }

  getTrackLocation(id: string): StoredTrackLocation | undefined {
    const row = this.database
      .prepare('SELECT id, file_path, lrc_path FROM tracks WHERE id = ?')
      .get(id) as { id: string; file_path: string; lrc_path: string | null } | undefined;
    if (!row) return undefined;
    return { id: row.id, filePath: row.file_path, lrcPath: row.lrc_path };
  }

  getArtwork(id: string): StoredArtwork | undefined {
    const row = this.database
      .prepare('SELECT artwork_mime, artwork FROM tracks WHERE id = ?')
      .get(id) as { artwork_mime: string | null; artwork: Buffer | null } | undefined;
    if (!row?.artwork_mime || !row.artwork) return undefined;
    return { mime: row.artwork_mime, data: row.artwork };
  }

  close(): void {
    if (this.database.open) this.database.close();
  }
}
