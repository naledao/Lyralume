import Database from 'better-sqlite3';
import path from 'node:path';
import type {
  BilingualLyricsTask,
  LibraryRoot,
  LibrarySnapshot,
  LocalLyricsTask,
  OnlineLyricsTask,
  PlaybackCheckpoint,
  PlaybackProgress,
  PlaybackStateSnapshot,
  RemoteCatalogEntry,
  RemoteSyncRecord,
  Track,
  TrackMetadataUpdate,
} from '../../shared/contracts.js';
import {
  AUDIO_ANALYSIS_VERSION,
  VISUAL_MAPPING_VERSION,
  type TrackVisualAnalysis,
} from '../../shared/visual-analysis.js';
import {
  normalizeTrackLanguage,
  UNKNOWN_ALBUM,
  UNKNOWN_ARTIST,
} from '../../shared/contracts.js';
import type { ScannedTrack, StoredArtwork, StoredTrackLocation } from './types.js';

interface TrackRow {
  id: string;
  file_name: string;
  title: string;
  artist: string;
  album: string;
  language: string | null;
  duration: number;
  file_size: number;
  modified_at: number;
  added_at: number;
  lrc_path: string | null;
  has_embedded_lyrics: number;
  artwork_mime: string | null;
}

interface RootRow {
  path: string;
  added_at: number;
}

interface PlaybackProgressRow {
  track_id: string;
  position_ms: number;
  duration_ms: number;
  completed: number;
  reason: PlaybackCheckpoint['reason'];
  updated_at: number;
}

interface VisualAnalysisRow {
  track_id: string;
  status: TrackVisualAnalysis['status'];
  progress: number;
  analysis_version: number;
  mapping_version: number;
  source_size: number;
  source_modified_at: number;
  content_fingerprint: string | null;
  profile_json: string | null;
  timeline_json: string | null;
  visual_dna_json: string | null;
  error: string | null;
  updated_at: number;
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
        language TEXT,
        language_override TEXT,
        duration REAL NOT NULL DEFAULT 0,
        file_size INTEGER NOT NULL,
        modified_at INTEGER NOT NULL,
        added_at INTEGER NOT NULL,
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

      CREATE TABLE IF NOT EXISTS bilingual_lyrics_tasks (
        track_id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL UNIQUE,
        status TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (track_id) REFERENCES tracks(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS playback_progress (
        track_id TEXT PRIMARY KEY,
        position_ms INTEGER NOT NULL,
        duration_ms INTEGER NOT NULL,
        completed INTEGER NOT NULL DEFAULT 0,
        reason TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS playback_session (
        singleton_id INTEGER PRIMARY KEY CHECK (singleton_id = 1),
        current_track_id TEXT,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS track_visual_analysis (
        track_id TEXT PRIMARY KEY,
        status TEXT NOT NULL,
        progress REAL NOT NULL DEFAULT 0,
        analysis_version INTEGER NOT NULL,
        mapping_version INTEGER NOT NULL,
        source_size INTEGER NOT NULL,
        source_modified_at REAL NOT NULL,
        content_fingerprint TEXT,
        profile_json TEXT,
        timeline_json TEXT,
        visual_dna_json TEXT,
        error TEXT,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (track_id) REFERENCES tracks(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_track_visual_analysis_status
        ON track_visual_analysis(status, updated_at);

      CREATE TABLE IF NOT EXISTS remote_sync_records (
        track_id TEXT PRIMARY KEY,
        sync_id TEXT NOT NULL UNIQUE,
        status TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_remote_sync_records_status
        ON remote_sync_records(status, updated_at);

      CREATE TABLE IF NOT EXISTS remote_music_cache (
        object_name TEXT PRIMARY KEY,
        sync_id TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        refreshed_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_remote_music_cache_sync_id
        ON remote_music_cache(sync_id);
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
    if (!trackColumns.has('language')) {
      this.database.exec('ALTER TABLE tracks ADD COLUMN language TEXT');
    }
    if (!trackColumns.has('language_override')) {
      this.database.exec('ALTER TABLE tracks ADD COLUMN language_override TEXT');
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
    if (!trackColumns.has('added_at')) {
      this.database.exec(`
        ALTER TABLE tracks ADD COLUMN added_at INTEGER NOT NULL DEFAULT 0;
        UPDATE tracks SET added_at = updated_at WHERE added_at = 0;
      `);
    }
    this.database.exec(
      'CREATE INDEX IF NOT EXISTS idx_tracks_added_at ON tracks(added_at DESC)',
    );
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
        id, root_path, file_path, file_name, title, artist, album, language, duration,
        file_size, modified_at, added_at, lrc_path, has_embedded_lyrics, artwork_mime, artwork, updated_at
      ) VALUES (
        @id, @rootPath, @filePath, @fileName, @title, @artist, @album, @language, @duration,
        @fileSize, @modifiedAt, @addedAt, @lrcPath, @hasEmbeddedLyrics, @artworkMime, @artwork, @updatedAt
      )
      ON CONFLICT(file_path) DO UPDATE SET
        root_path = excluded.root_path,
        file_name = excluded.file_name,
        title = excluded.title,
        artist = excluded.artist,
        album = excluded.album,
        language = excluded.language,
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
          upsert.run({
            ...track,
            language: track.language ?? null,
            hasEmbeddedLyrics: track.hasEmbeddedLyrics ? 1 : 0,
            addedAt: updatedAt,
            updatedAt,
          });
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
                COALESCE(language_override, language) AS language,
                duration, file_size,
                modified_at, added_at, lrc_path, has_embedded_lyrics, artwork_mime
         FROM tracks
         ORDER BY added_at DESC,
                  artist COLLATE NOCASE,
                  album COLLATE NOCASE,
                  title COLLATE NOCASE,
                  id ASC`,
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
      language: normalizeTrackLanguage(row.language),
      duration: row.duration,
      fileSize: row.file_size,
      modifiedAt: row.modified_at,
      hasLyrics: Boolean(row.lrc_path || row.has_embedded_lyrics),
      hasArtwork: Boolean(row.artwork_mime),
      playbackUrl: `lyralume-media://track/${row.id}`,
      artworkUrl: row.artwork_mime
        ? `lyralume-media://artwork/${row.id}?v=${Math.round(row.modified_at)}`
        : undefined,
    };
  }

  getTrackLocation(id: string): StoredTrackLocation | undefined {
    const row = this.database
      .prepare(
        `SELECT id, file_path, lrc_path, prefer_embedded_lyrics,
                COALESCE(NULLIF(title_override, ''), title) AS title,
                COALESCE(NULLIF(artist_override, ''), artist) AS artist,
                COALESCE(NULLIF(album_override, ''), album) AS album,
                COALESCE(language_override, language) AS language,
                duration, file_size, modified_at
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
        language: string | null;
        duration: number;
        file_size: number;
        modified_at: number;
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
      language: normalizeTrackLanguage(row.language),
      duration: row.duration,
      fileSize: row.file_size,
      modifiedAt: row.modified_at,
    };
  }

  setTrackArtwork(
    id: string,
    artworkMime: string,
    artwork: Buffer,
    fileSize: number,
    modifiedAt: number,
  ): boolean {
    const result = this.database.prepare(`
      UPDATE tracks
      SET artwork_mime = ?, artwork = ?, file_size = ?, modified_at = ?, updated_at = ?
      WHERE id = ?
    `).run(artworkMime, artwork, fileSize, modifiedAt, Date.now(), id);
    return result.changes > 0;
  }

  createPendingVisualAnalysis(
    trackId: string,
    sourceSize: number,
    sourceModifiedAt: number,
  ): TrackVisualAnalysis {
    return this.saveVisualAnalysis({
      trackId,
      status: 'pending',
      progress: 0,
      analysisVersion: AUDIO_ANALYSIS_VERSION,
      mappingVersion: VISUAL_MAPPING_VERSION,
      sourceSize,
      sourceModifiedAt,
      updatedAt: Date.now(),
    });
  }

  getVisualAnalysis(trackId: string): TrackVisualAnalysis | undefined {
    const row = this.database
      .prepare('SELECT * FROM track_visual_analysis WHERE track_id = ?')
      .get(trackId) as VisualAnalysisRow | undefined;
    return row ? this.toVisualAnalysis(row) : undefined;
  }

  saveVisualAnalysis(analysis: TrackVisualAnalysis): TrackVisualAnalysis {
    this.database.prepare(`
      INSERT INTO track_visual_analysis(
        track_id, status, progress, analysis_version, mapping_version,
        source_size, source_modified_at, content_fingerprint,
        profile_json, timeline_json, visual_dna_json, error, updated_at
      ) VALUES (
        @trackId, @status, @progress, @analysisVersion, @mappingVersion,
        @sourceSize, @sourceModifiedAt, @contentFingerprint,
        @profileJson, @timelineJson, @visualDnaJson, @error, @updatedAt
      )
      ON CONFLICT(track_id) DO UPDATE SET
        status = excluded.status,
        progress = excluded.progress,
        analysis_version = excluded.analysis_version,
        mapping_version = excluded.mapping_version,
        source_size = excluded.source_size,
        source_modified_at = excluded.source_modified_at,
        content_fingerprint = COALESCE(excluded.content_fingerprint, content_fingerprint),
        profile_json = COALESCE(excluded.profile_json, profile_json),
        timeline_json = COALESCE(excluded.timeline_json, timeline_json),
        visual_dna_json = COALESCE(excluded.visual_dna_json, visual_dna_json),
        error = excluded.error,
        updated_at = excluded.updated_at
    `).run({
      ...analysis,
      contentFingerprint: analysis.contentFingerprint ?? null,
      profileJson: analysis.profile ? JSON.stringify(analysis.profile) : null,
      timelineJson: analysis.timeline ? JSON.stringify(analysis.timeline) : null,
      visualDnaJson: analysis.visualDNA ? JSON.stringify(analysis.visualDNA) : null,
      error: analysis.error ?? null,
    });
    return this.getVisualAnalysis(analysis.trackId) ?? analysis;
  }

  updateVisualAnalysisProgress(trackId: string, progress: number): TrackVisualAnalysis | undefined {
    this.database.prepare(`
      UPDATE track_visual_analysis
      SET progress = ?, updated_at = ?
      WHERE track_id = ? AND status = 'running'
    `).run(Math.min(1, Math.max(0, progress)), Date.now(), trackId);
    return this.getVisualAnalysis(trackId);
  }

  markVisualAnalysisStale(trackId: string): TrackVisualAnalysis | undefined {
    this.database.prepare(`
      UPDATE track_visual_analysis
      SET status = 'stale', progress = 0, updated_at = ?
      WHERE track_id = ? AND status != 'running'
    `).run(Date.now(), trackId);
    return this.getVisualAnalysis(trackId);
  }

  private toVisualAnalysis(row: VisualAnalysisRow): TrackVisualAnalysis {
    const parse = <T>(value: string | null): T | undefined => {
      if (!value) return undefined;
      try {
        return JSON.parse(value) as T;
      } catch {
        return undefined;
      }
    };
    return {
      trackId: row.track_id,
      status: row.status,
      progress: row.progress,
      analysisVersion: row.analysis_version,
      mappingVersion: row.mapping_version,
      sourceSize: row.source_size,
      sourceModifiedAt: row.source_modified_at,
      contentFingerprint: row.content_fingerprint ?? undefined,
      profile: parse(row.profile_json),
      timeline: parse(row.timeline_json),
      visualDNA: parse(row.visual_dna_json),
      error: row.error ?? undefined,
      updatedAt: row.updated_at,
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
    const language = metadata.language || null;
    const result = this.database
      .prepare(
        `UPDATE tracks
         SET title_override = COALESCE(?, title_override),
             artist_override = COALESCE(?, artist_override),
             album_override = COALESCE(?, album_override),
             language_override = COALESCE(?, language_override),
             title = COALESCE(?, title),
             artist = COALESCE(?, artist),
             album = COALESCE(?, album),
             language = COALESCE(?, language),
             updated_at = ?
         WHERE id = ?`,
      )
      .run(
        metadata.title?.trim() ?? null,
        metadata.artist?.trim() ?? null,
        metadata.album?.trim() ?? null,
        metadata.language ?? null,
        title,
        artist,
        album,
        language,
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

  ignoreFileForAutomaticScan(filePath: string): boolean {
    const normalizedPath = path.resolve(filePath);
    const containingRoot = this.getRoots()
      .map((root) => root.path)
      .sort((left, right) => right.length - left.length)
      .find((rootPath) => {
        const relative = path.relative(path.resolve(rootPath), normalizedPath);
        return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
      });
    if (!containingRoot) return false;

    this.database.transaction(() => {
      this.database.prepare(`
        INSERT INTO ignored_library_files(file_path, root_path, ignored_at)
        VALUES (?, ?, ?)
        ON CONFLICT(file_path) DO UPDATE SET
          root_path = excluded.root_path,
          ignored_at = excluded.ignored_at
      `).run(normalizedPath, containingRoot, Date.now());
      this.database.prepare('DELETE FROM tracks WHERE file_path = ?').run(normalizedPath);
    })();
    return true;
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

  getLocalLyricsTasks(): LocalLyricsTask[] {
    const rows = this.database
      .prepare('SELECT payload_json FROM local_lyrics_tasks ORDER BY updated_at DESC')
      .all() as Array<{ payload_json: string }>;
    return rows.flatMap((row) => {
      try {
        return [JSON.parse(row.payload_json) as LocalLyricsTask];
      } catch {
        return [];
      }
    });
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

  getBilingualLyricsTask(trackId: string): BilingualLyricsTask | undefined {
    const row = this.database
      .prepare('SELECT payload_json FROM bilingual_lyrics_tasks WHERE track_id = ?')
      .get(trackId) as { payload_json: string } | undefined;
    if (!row) return undefined;
    try {
      return JSON.parse(row.payload_json) as BilingualLyricsTask;
    } catch {
      return undefined;
    }
  }

  getBilingualLyricsTasks(): BilingualLyricsTask[] {
    const rows = this.database
      .prepare('SELECT payload_json FROM bilingual_lyrics_tasks ORDER BY updated_at DESC')
      .all() as Array<{ payload_json: string }>;
    return rows.flatMap((row) => {
      try {
        return [JSON.parse(row.payload_json) as BilingualLyricsTask];
      } catch {
        return [];
      }
    });
  }

  saveBilingualLyricsTask(task: BilingualLyricsTask): void {
    this.database
      .prepare(
        `INSERT INTO bilingual_lyrics_tasks(track_id, task_id, status, payload_json, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(track_id) DO UPDATE SET
           task_id = excluded.task_id,
           status = excluded.status,
           payload_json = excluded.payload_json,
           updated_at = excluded.updated_at`,
      )
      .run(task.trackId, task.id, task.status, JSON.stringify(task), task.updatedAt);
  }

  getRemoteSyncRecord(trackId: string): RemoteSyncRecord | undefined {
    const row = this.database
      .prepare('SELECT payload_json FROM remote_sync_records WHERE track_id = ?')
      .get(trackId) as { payload_json: string } | undefined;
    if (!row) return undefined;
    try {
      return JSON.parse(row.payload_json) as RemoteSyncRecord;
    } catch {
      return undefined;
    }
  }

  getRemoteSyncRecords(): RemoteSyncRecord[] {
    const rows = this.database
      .prepare('SELECT payload_json FROM remote_sync_records ORDER BY updated_at DESC')
      .all() as Array<{ payload_json: string }>;
    return rows.flatMap((row) => {
      try {
        return [JSON.parse(row.payload_json) as RemoteSyncRecord];
      } catch {
        return [];
      }
    });
  }

  saveRemoteSyncRecord(record: RemoteSyncRecord): void {
    this.database.prepare(`
      INSERT INTO remote_sync_records(track_id, sync_id, status, payload_json, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(track_id) DO UPDATE SET
        sync_id = excluded.sync_id,
        status = excluded.status,
        payload_json = excluded.payload_json,
        updated_at = excluded.updated_at
    `).run(
      record.trackId,
      record.syncId,
      record.status,
      JSON.stringify(record),
      record.updatedAt,
    );
  }

  deleteRemoteSyncRecord(trackId: string): void {
    this.database.prepare('DELETE FROM remote_sync_records WHERE track_id = ?').run(trackId);
  }

  getRemoteMusicCache(): RemoteCatalogEntry[] {
    const rows = this.database
      .prepare('SELECT payload_json FROM remote_music_cache ORDER BY object_name ASC')
      .all() as Array<{ payload_json: string }>;
    return rows.flatMap((row) => {
      try {
        return [JSON.parse(row.payload_json) as RemoteCatalogEntry];
      } catch {
        return [];
      }
    });
  }

  replaceRemoteMusicCache(entries: RemoteCatalogEntry[], refreshedAt: number): void {
    const insert = this.database.prepare(`
      INSERT INTO remote_music_cache(object_name, sync_id, payload_json, refreshed_at)
      VALUES (?, ?, ?, ?)
    `);
    this.database.transaction(() => {
      this.database.prepare('DELETE FROM remote_music_cache').run();
      for (const entry of entries) {
        insert.run(entry.objectName, entry.syncId, JSON.stringify(entry), refreshedAt);
      }
    })();
  }

  saveRemoteMusicCacheEntry(entry: RemoteCatalogEntry, refreshedAt: number): void {
    this.database.prepare(`
      INSERT INTO remote_music_cache(object_name, sync_id, payload_json, refreshed_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(object_name) DO UPDATE SET
        sync_id = excluded.sync_id,
        payload_json = excluded.payload_json,
        refreshed_at = excluded.refreshed_at
    `).run(entry.objectName, entry.syncId, JSON.stringify(entry), refreshedAt);
  }

  getArtwork(id: string): StoredArtwork | undefined {
    const row = this.database
      .prepare('SELECT artwork_mime, artwork FROM tracks WHERE id = ?')
      .get(id) as { artwork_mime: string | null; artwork: Buffer | null } | undefined;
    if (!row?.artwork_mime || !row.artwork) return undefined;
    return { mime: row.artwork_mime, data: row.artwork };
  }

  getPlaybackState(): PlaybackStateSnapshot {
    const rows = this.database
      .prepare(
        `SELECT track_id, position_ms, duration_ms, completed, reason, updated_at
         FROM playback_progress
         ORDER BY updated_at DESC`,
      )
      .all() as PlaybackProgressRow[];
    const session = this.database
      .prepare('SELECT current_track_id FROM playback_session WHERE singleton_id = 1')
      .get() as { current_track_id: string | null } | undefined;
    return {
      lastTrackId: session?.current_track_id ?? null,
      progress: rows.map((row) => this.toPlaybackProgress(row)),
    };
  }

  savePlaybackCheckpoint(checkpoint: PlaybackCheckpoint): PlaybackProgress {
    const now = Date.now();
    const durationMs = Math.max(0, checkpoint.durationMs);
    const requestedPosition = checkpoint.completed ? 0 : Math.max(0, checkpoint.positionMs);
    const positionMs = durationMs > 0
      ? Math.min(requestedPosition, durationMs)
      : requestedPosition;
    const progress: PlaybackProgress = {
      ...checkpoint,
      positionMs,
      durationMs,
      updatedAt: now,
    };
    this.database.transaction(() => {
      this.database.prepare(
        `INSERT INTO playback_progress(
           track_id, position_ms, duration_ms, completed, reason, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(track_id) DO UPDATE SET
           position_ms = excluded.position_ms,
           duration_ms = excluded.duration_ms,
           completed = excluded.completed,
           reason = excluded.reason,
           updated_at = excluded.updated_at`,
      ).run(
        progress.trackId,
        progress.positionMs,
        progress.durationMs,
        progress.completed ? 1 : 0,
        progress.reason,
        progress.updatedAt,
      );
      this.database.prepare(
        `INSERT INTO playback_session(singleton_id, current_track_id, updated_at)
         VALUES (1, ?, ?)
         ON CONFLICT(singleton_id) DO UPDATE SET
           current_track_id = excluded.current_track_id,
           updated_at = excluded.updated_at`,
      ).run(progress.trackId, progress.updatedAt);
    })();
    return progress;
  }

  private toPlaybackProgress(row: PlaybackProgressRow): PlaybackProgress {
    return {
      trackId: row.track_id,
      positionMs: row.position_ms,
      durationMs: row.duration_ms,
      completed: Boolean(row.completed),
      reason: row.reason,
      updatedAt: row.updated_at,
    };
  }

  close(): void {
    if (this.database.open) this.database.close();
  }
}
