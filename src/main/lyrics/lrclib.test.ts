// @vitest-environment node

import { describe, expect, it, vi } from 'vitest';
import { LrclibClient, LrclibError } from './lrclib';

describe('LrclibClient', () => {
  it('uses structured query fields and validates returned records', async () => {
    const fetchImplementation = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      expect(url.searchParams.get('track_name')).toBe('Song & More');
      expect(url.searchParams.get('artist_name')).toBe('Artist');
      expect(url.searchParams.get('album_name')).toBe('Album');
      return new Response(JSON.stringify([
        {
          id: 12,
          trackName: 'Song & More',
          artistName: 'Artist',
          albumName: 'Album',
          duration: 120,
          instrumental: false,
          plainLyrics: 'Words',
          syncedLyrics: '[00:01.00]Words',
        },
        { malformed: true },
      ]));
    }) as typeof fetch;
    const client = new LrclibClient(fetchImplementation);
    const result = await client.search({
      title: 'Song & More',
      artist: 'Artist',
      album: 'Album',
      duration: 120,
    });
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(12);
  });

  it('distinguishes network failures from service responses', async () => {
    const offline = new LrclibClient(vi.fn(async () => {
      throw new TypeError('offline');
    }) as typeof fetch);
    await expect(offline.search({ title: 'Song', artist: '', album: '', duration: 1 }))
      .rejects.toMatchObject<LrclibError>({ kind: 'network' });

    const unavailable = new LrclibClient(vi.fn(async () => new Response('', { status: 503 })) as typeof fetch);
    await expect(unavailable.search({ title: 'Song', artist: '', album: '', duration: 1 }))
      .rejects.toMatchObject<LrclibError>({ kind: 'service' });
  });
});
