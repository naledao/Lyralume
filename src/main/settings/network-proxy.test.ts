import { describe, expect, it } from 'vitest';
import { normalizeProxyUrl } from './network-proxy.js';

describe('normalizeProxyUrl', () => {
  it('adds the HTTP scheme for a local proxy', () => {
    expect(normalizeProxyUrl('127.0.0.1:7890')).toBe('http://127.0.0.1:7890');
  });

  it('accepts SOCKS5 and rejects credentials or paths', () => {
    expect(normalizeProxyUrl('socks5://localhost:1080')).toBe('socks5://localhost:1080');
    expect(() => normalizeProxyUrl('http://user:pass@localhost:7890')).toThrow('账号密码');
    expect(() => normalizeProxyUrl('http://localhost:7890/path')).toThrow('路径');
  });
});
