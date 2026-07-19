import Database from 'better-sqlite3';
import path from 'node:path';
import type {
  LibraryRoot,
  LibrarySnapshot,
  LocalLyricsTask,
  OnlineLyricsTask,
  Track,
  TrackMetadataUpdate,
} from '../../shared/contracts.js';
import { UNKNOWN_ALBUM, UNKNOWN_ARTIST } from '../../shared/contracts.js';
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
  has_embedded_lyrics: number;
  artwork_mime: string | null;
}

interface RootRow {
  path: string;
  added_at: number;
}

export interface RemovedLibraryTrack {
  filePath: string;
  rootPath: string;
  rootRemoved: boolean;
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
        title_override TEXT,
        artist TEXT NOT NULL,
        album TEXT NOT NULL,
        artist_override TEXT,
        album_override TEXT,
        duration REAL NOT NULL DEFAULT 0,
        file_size INTEGER NOT NULL,
        modified_at INTEGER NOT NULL,
        lrc_path TEXT,
        has_embedded_lyrics INTEGER NOT NULL DEFAULT 0,
        prefer_embedded_lyrics INTEGER NOT NULL DEFAULT 0,
        artwork_mime TEXT,
        artwork BLOB,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (root_path) REFERENCES library_roots(path) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_tracks_title ON tracks(title COLLATE NOCASE);
      CREATE INDEX IF NOT EXISTS idx_tracks_artist ON tracks(artist COLLATE NOCASE);
      CREATE INDEX IF NOT EXISTS idx_tracks_root ON tracks(root_path);

      CREATE TABLE IF NOT EXISTS ignored_library_files (
        file_path TEXT PRIMARY KEY,
        root_path TEXT NOT NULL,
        ignored_at INTEGER NOT NULL,
        FOREIGN KEY (root_path) REFERENCES library_roots(path) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_ignored_library_files_root
        ON ignored_library_files(root_path);

      CREATE TABLE IF NOT EXISTS online_lyrics_tasks (
        track_id TEXT PRIMARY KEY,
        status TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (track_id) REFERENCES tracks(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS local_lyrics_tasks (
        track_id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL UNIQUE,
        status TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (track_id) REFERENCES tracks(id) ON DELETE CASCADE
      );
    `);

    const trackColumns = new Set(
      (this.database.prepare('PRAGMA table_info(tracks)').all() as Array<{ name: string }>)
        .map((column) => column.name),
    );
    if (!trackColumns.has('title_override')) {
      this.database.exec('ALTER TABLE tracks ADD COLUMN title_override TEXT');
    }
    if (!trackColumns.has('artist_override')) {
      this.database.exec('ALTER TABLE tracks ADD COLUMN artist_override TEXT');
    }
    if (!trackColumns.has('album_override')) {
      this.database.exec('ALTER TABLE tracks ADD COLUMN album_override TEXT');
    }
    if (!trackColumns.has('has_embedded_lyrics')) {
      this.database.exec(
        'ALTER TABLE tracks ADD COLUMN has_embedded_lyrics INTEGER NOT NULL DEFAULT 0',
      );
    }
    if (!trackColumns.has('prefer_embedded_lyrics')) {
      this.database.exec(
        'ALTER TABLE tracks ADD COLUMN prefer_embedded_lyrics INTEGER NOT NULL DEFAULT 0',
      );
    }
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
        file_size, modified_at, lrc_path, has_embedded_lyrics, artwork_mime, artwork, updated_at
      ) VALUES (
        @id, @rootPath, @filePath, @fileName, @title, @artist, @album, @duration,
        @fileSize, @modifiedAt, @lrcPath, @hasEmbeddedLyrics, @artworkMime, @artwork, @updatedAt
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
        has_embedded_lyrics = excluded.has_embedded_lyrics,
        artwork_mime = excluded.artwork_mime,
        artwork = excluded.artwork,
        updated_at = excluded.updated_at
    `);
    const existing = this.database.prepare('SELECT file_path FROM tracks WHERE root_path = ?');
    const ignored = this.database.prepare(
      'SELECT file_path FROM ignored_library_files WHERE root_path = ?',
    );
    const remove = this.database.prepare('DELETE FROM tracks WHERE root_path = ? AND file_path = ?');

    this.database.transaction(() => {
      this.addRoot(rootPath);
      const updatedAt = Date.now();
      const ignoredPaths = new Set(
        (ignored.all(rootPath) as Array<{ file_path: string }>).map((row) => row.file_path),
      );
      for (const track of tracks) {
        if (!ignoredPaths.has(track.filePath)) {
          upsert.run({ ...track, hasEmbeddedLyrics: track.hasEmbeddedLyrics ? 1 : 0, updatedAt });
        }
      }
      const existingRows = existing.all(rootPath) as Array<{ file_path: string }>;
      for (const row of existingRows) {
        if (!discoveredPaths.has(row.file_path)) remove.run(rootPath, row.file_path);
      }
    })();
  }

  getSnapshot(): LibrarySnapshot {
    const rows = this.database
      .prepare(
        `SELECT id, file_name,
                COALESCE(NULLIF(title_override, ''), title) AS title,
                COALESCE(NULLIF(artist_override, ''), artist) AS artist,
                COALESCE(NULLIF(album_override, ''), album) AS album,
                duration, file_size,
                modified_at, lrc_path, has_embedded_lyrics, artwork_mime
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
      hasLyrics: Boolean(row.lrc_path || row.has_embedded_lyrics),
      hasArtwork: Boolean(row.artwork_mime),
      playbackUrl: `lyralume-media://track/${row.id}`,
      artworkUrl: row.artwork_mime ? `lyralume-media://artwork/${row.id}` : undefined,
    };
  }

  getTrackLocation(id: string): StoredTrackLocation | undefined {
    const row = this.database
      .prepare(
        `SELECT id, file_path, lrc_path, prefer_embedded_lyrics,
                COALESCE(NULLIF(title_override, ''), title) AS title,
                COALESCE(NULLIF(artist_override, ''), artist) AS artist,
                COALESCE(NULLIF(album_override, ''), album) AS album,
                duration
         FROM tracks WHERE id = ?`,
      )
      .get(id) as {
        id: string;
        file_path: string;
        lrc_path: string | null;
        prefer_embedded_lyrics: number;
        title: string;
        artist: string;
        album: string;
        duration: number;
      } | undefined;
    if (!row) return undefined;
    return {
      id: row.id,
      filePath: row.file_path,
      lrcPath: row.lrc_path,
      preferEmbeddedLyrics: Boolean(row.prefer_embedded_lyrics),
      title: row.title,
      artist: row.artist,
      album: row.album,
      duration: row.duration,
    };
  }

  setTrackLrcPath(id: string, lrcPath: string): boolean {
    const result = this.database
      .prepare(
        'UPDATE tracks SET lrc_path = ?, prefer_embedded_lyrics = 0, updated_at = ? WHERE id = ?',
      )
      .run(lrcPath, Date.now(), id);
    return result.changes === 1;
  }

  setTrackEmbeddedLyrics(id: string, hasEmbeddedLyrics: boolean): boolean {
    const result = this.database
      .prepare('UPDATE tracks SET has_embedded_lyrics = ?, updated_at = ? WHERE id = ?')
      .run(hasEmbeddedLyrics ? 1 : 0, Date.now(), id);
    return result.changes === 1;
  }

  setTrackPreferEmbeddedLyrics(id: string, preferEmbeddedLyrics: boolean): boolean {
    const result = this.database
      .prepare('UPDATE tracks SET prefer_embedded_lyrics = ?, updated_at = ? WHERE id = ?')
      .run(preferEmbeddedLyrics ? 1 : 0, Date.now(), id);
    return result.changes === 1;
  }

  setTrackMetadata(id: string, metadata: TrackMetadataUpdate): boolean {
    const row = this.database
      .prepare('SELECT file_name FROM tracks WHERE id = ?')
      .get(id) as { file_name: string } | undefined;
    if (!row) return false;
    const title = metadata.title === undefined
      ? null
      : metadata.title || path.parse(row.file_name).name;
    const artist = metadata.artist === undefined
      ? null
      : metadata.artist || UNKNOWN_ARTIST;
    const album = metadata.album === undefined
      ? null
      : metadata.album || UNKNOWN_ALBUM;
    const result = this.database
      .prepare(
        `UPDATE tracks
         SET title_override = COALESCE(?, title_override),
             artist_override = COALESCE(?, artist_override),
             album_override = COALESCE(?, album_override),
             title = COALESCE(?, title),
             artist = COALESCE(?, artist),
             album = COALESCE(?, album),
             updated_at = ?
         WHERE id = ?`,
      )
      .run(
        metadata.title?.trim() ?? null,
        metadata.artist?.trim() ?? null,
        metadata.album?.trim() ?? null,
        title,
        artist,
        album,
        Date.now(),
        id,
      );
    return result.changes === 1;
  }

  removeTrack(id: string): RemovedLibraryTrack | undefined {
    const row = this.database
      .prepare('SELECT file_path, root_path FROM tracks WHERE id = ?')
      .get(id) as { file_path: string; root_path: string } | undefined;
    if (!row) return undefined;

    const rootRemoved = row.file_path.toLocaleLowerCase() === row.root_path.toLocaleLowerCase();
    this.database.transaction(() => {
      if (rootRemoved) {
        this.database.prepare('DELETE FROM library_roots WHERE path = ?').run(row.root_path);
      } else {
        this.database.prepare(`
          INSERT INTO ignored_library_files(file_path, root_path, ignored_at)
          VALUES (?, ?, ?)
          ON CONFLICT(file_path) DO UPDATE SET
            root_path = excluded.root_path,
            ignored_at = excluded.ignored_at
        `).run(row.file_path, row.root_path, Date.now());
        this.database.prepare('DELETE FROM tracks WHERE id = ?').run(id);
      }
    })();

    return {
      filePath: row.file_path,
      rootPath: row.root_path,
      rootRemoved,
    };
  }

  clearIgnoredForImport(importPath: string): void {
    this.database
      .prepare('DELETE FROM ignored_library_files WHERE file_path = ? OR root_path = ?')
      .run(importPath, importPath);
  }

  getOnlineLyricsTask(trackId: string): OnlineLyricsTask | undefined {
    const row = this.database
      .prepare('SELECT payload_json FROM online_lyrics_tasks WHERE track_id = ?')
      .get(trackId) as { payload_json: string } | undefined;
    if (!row) return undefined;
    try {
      return JSON.parse(row.payload_json) as OnlineLyricsTask;
    } catch {
      return undefined;
    }
  }

  saveOnlineLyricsTask(task: OnlineLyricsTask): void {
    this.database
      .prepare(
        `INSERT INTO online_lyrics_tasks(track_id, status, payload_json, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(track_id) DO UPDATE SET
           status = excluded.status,
           payload_json = excluded.payload_json,
           updated_at = excluded.updated_at`,
      )
      .run(task.trackId, task.status, JSON.stringify(task), task.updatedAt);
  }

  getLocalLyricsTask(trackId: string): LocalLyricsTask | undefined {
    const row = this.database
      .prepare('SELECT payload_json FROM local_lyrics_tasks WHERE track_id = ?')
      .get(trackId) as { payload_json: string } | undefined;
    if (!row) return undefined;
    try {
      return JSON.parse(row.payload_json) as LocalLyricsTask;
    } catch {
      return undefined;
    }
  }

  saveLocalLyricsTask(task: LocalLyricsTask): void {
    this.database
      .prepare(
        `INSERT INTO local_lyrics_tasks(track_id, task_id, status, payload_json, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(track_id) DO UPDATE SET
           task_id = excluded.task_id,
           status = excluded.status,
           payload_json = excluded.payload_json,
           updated_at = excluded.updated_at`,
      )
      .run(task.trackId, task.id, task.status, JSON.stringify(task), task.updatedAt);
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
