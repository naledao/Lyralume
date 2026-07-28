import { describe, expect, it } from 'vitest';
import { parseProgressLine } from './service.js';

describe('music download progress', () => {
  it('parses the stable yt-dlp progress template', () => {
    expect(parseProgressLine('LYRALUME_PROGRESS:524288|1048576|NA|131072|4')).toEqual({
      downloadedBytes: 524288,
      totalBytes: 1048576,
      speedBytesPerSecond: 131072,
      etaSeconds: 4,
    });
  });

  it('ignores regular yt-dlp output', () => {
    expect(parseProgressLine('[download] Destination: example.webm')).toBeNull();
  });
});
