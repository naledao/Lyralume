// @vitest-environment node

import { describe, expect, it } from 'vitest';
import { allowRendererMediaAccess } from './media-response';

describe('media protocol response', () => {
  it('preserves range metadata and allows the Web Audio graph to consume media', async () => {
    const source = new Response('audio', {
      status: 206,
      headers: {
        'Accept-Ranges': 'bytes',
        'Content-Range': 'bytes 0-4/5',
      },
    });

    const result = allowRendererMediaAccess(source);

    expect(result.status).toBe(206);
    expect(result.headers.get('Content-Range')).toBe('bytes 0-4/5');
    expect(result.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(result.headers.get('Cross-Origin-Resource-Policy')).toBe('cross-origin');
    expect(await result.text()).toBe('audio');
  });
});
