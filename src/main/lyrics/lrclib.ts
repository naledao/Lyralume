const LRCLIB_SEARCH_URL = 'https://lrclib.net/api/search';
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;

export interface LyricsSearchTrack {
  title: string;
  artist: string;
  album: string;
  duration: number;
}

export interface LrclibRecord {
  id: number;
  trackName: string;
  artistName: string;
  albumName: string;
  duration: number;
  instrumental: boolean;
  plainLyrics: string | null;
  syncedLyrics: string | null;
}

export class LrclibError extends Error {
  constructor(
    readonly kind: 'network' | 'service',
    message: string,
  ) {
    super(message);
    this.name = 'LrclibError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function toLrclibRecord(value: unknown): LrclibRecord | null {
  if (!isRecord(value)) return null;
  if (
    typeof value.id !== 'number'
    || !Number.isInteger(value.id)
    || typeof value.trackName !== 'string'
    || typeof value.artistName !== 'string'
    || typeof value.albumName !== 'string'
    || typeof value.duration !== 'number'
    || typeof value.instrumental !== 'boolean'
  ) return null;
  return {
    id: value.id,
    trackName: value.trackName,
    artistName: value.artistName,
    albumName: value.albumName,
    duration: Number.isFinite(value.duration) ? value.duration : 0,
    instrumental: value.instrumental,
    plainLyrics: typeof value.plainLyrics === 'string' ? value.plainLyrics : null,
    syncedLyrics: typeof value.syncedLyrics === 'string' ? value.syncedLyrics : null,
  };
}

export class LrclibClient {
  constructor(
    private readonly fetchImplementation: typeof fetch = globalThis.fetch,
    private readonly timeoutMs = 12_000,
  ) {}

  async search(track: LyricsSearchTrack): Promise<LrclibRecord[]> {
    const url = new URL(LRCLIB_SEARCH_URL);
    url.searchParams.set('track_name', track.title);
    if (track.artist && track.artist !== '未知艺术家') url.searchParams.set('artist_name', track.artist);
    if (track.album && track.album !== '未知专辑') url.searchParams.set('album_name', track.album);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImplementation(url, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          'User-Agent': 'Lyralume/0.1.0 (local music player)',
        },
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new LrclibError('service', `LRCLIB 返回了 HTTP ${response.status}`);
      }
      const raw = await response.text();
      if (Buffer.byteLength(raw, 'utf8') > MAX_RESPONSE_BYTES) {
        throw new LrclibError('service', 'LRCLIB 响应过大，已拒绝处理');
      }
      let payload: unknown;
      try {
        payload = JSON.parse(raw);
      } catch {
        throw new LrclibError('service', 'LRCLIB 返回了无效数据');
      }
      if (!Array.isArray(payload)) throw new LrclibError('service', 'LRCLIB 响应格式不正确');
      return payload.map(toLrclibRecord).filter((record): record is LrclibRecord => Boolean(record));
    } catch (error) {
      if (error instanceof LrclibError) throw error;
      const message = error instanceof Error && error.name === 'AbortError'
        ? 'LRCLIB 查询超时，请稍后重试'
        : '无法连接 LRCLIB，请检查网络后重试';
      throw new LrclibError('network', message);
    } finally {
      clearTimeout(timeout);
    }
  }
}
