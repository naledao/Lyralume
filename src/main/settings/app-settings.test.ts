import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AppSettingsService,
  normalizeMinioEndpoint,
  type NetworkProxyApplier,
} from './app-settings.js';
import type { CredentialProtector } from './credential-protector.js';

describe('AppSettingsService', () => {
  let root = '';
  let downloads = '';
  let proxy: NetworkProxyApplier;
  let credentials: CredentialProtector;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'lyralume-settings-'));
    downloads = path.join(root, 'downloads');
    await mkdir(downloads);
    proxy = { apply: vi.fn(async () => undefined) };
    credentials = {
      isAvailable: vi.fn(async () => true),
      encrypt: vi.fn(async (value: string) => Buffer.from(`protected:${value}`)),
      decrypt: vi.fn(async (value: Buffer) => value.toString('utf8').replace(/^protected:/, '')),
    };
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('persists the download directory and normalized global proxy', async () => {
    const service = new AppSettingsService(root, downloads, proxy);
    await service.initialize();
    const customDownloads = path.join(root, 'custom-downloads');
    await mkdir(customDownloads);
    await service.setDownloadDirectory(customDownloads);
    const updated = await service.updateProxy({ enabled: true, url: '127.0.0.1:7890' });

    expect(updated).toMatchObject({
      downloadDirectory: customDownloads,
      proxyEnabled: true,
      proxyUrl: 'http://127.0.0.1:7890',
    });
    expect(proxy.apply).toHaveBeenLastCalledWith('http://127.0.0.1:7890');

    const restoredProxy = { apply: vi.fn(async () => undefined) };
    const restored = new AppSettingsService(root, downloads, restoredProxy);
    expect(await restored.initialize()).toMatchObject(updated);
    expect(restoredProxy.apply).toHaveBeenCalledWith('http://127.0.0.1:7890');
  });

  it('copies a Netscape cookie file and can remove it without exposing contents', async () => {
    const cookieSource = path.join(root, 'exported-cookies.txt');
    await writeFile(cookieSource, '# Netscape HTTP Cookie File\n.youtube.com\tTRUE\t/\tTRUE\t0\tSID\tsecret\n');
    const service = new AppSettingsService(root, downloads, proxy);
    await service.initialize();

    const imported = await service.importCookieFile(cookieSource);
    expect(imported.cookieConfigured).toBe(true);
    expect(imported.cookieFileName).toBe('exported-cookies.txt');
    expect(await service.getCookiePath()).toBe(path.join(root, 'settings', 'youtube-cookies.txt'));

    const cleared = await service.clearCookie();
    expect(cleared.cookieConfigured).toBe(false);
    expect(await service.getCookiePath()).toBeUndefined();
  });

  it('rejects cookie exports that are not Netscape cookie files', async () => {
    const cookieSource = path.join(root, 'cookies.json');
    await writeFile(cookieSource, '{"cookies":[]}');
    const service = new AppSettingsService(root, downloads, proxy);
    await service.initialize();
    await expect(service.importCookieFile(cookieSource)).rejects.toThrow('Netscape');
  });

  it('encrypts MinIO credentials without exposing the secret in snapshots or JSON', async () => {
    const service = new AppSettingsService(root, downloads, proxy, credentials);
    await service.initialize();
    const updated = await service.updateMinio({
      endpoint: 'minio.example.test:8084',
      bucket: 'lyralume-music',
      accessKey: 'music-sync',
      secretKey: ' private-secret ',
      autoSync: true,
    });

    expect(updated).toMatchObject({
      minioEndpoint: 'http://minio.example.test:8084',
      minioBucket: 'lyralume-music',
      minioAccessKey: 'music-sync',
      minioSecretConfigured: true,
      minioConfigured: true,
      minioAutoSync: true,
    });
    expect(JSON.stringify(updated)).not.toContain('private-secret');
    expect(await service.getMinioConnection()).toEqual({
      endpoint: 'http://minio.example.test:8084',
      bucket: 'lyralume-music',
      accessKey: 'music-sync',
      secretKey: ' private-secret ',
    });

    const restored = new AppSettingsService(root, downloads, proxy, credentials);
    expect(await restored.initialize()).toMatchObject(updated);
    expect(await restored.getMinioConnection()).toMatchObject({ secretKey: ' private-secret ' });
  });

  it('keeps an existing MinIO secret when a settings update omits it and can clear it', async () => {
    const service = new AppSettingsService(root, downloads, proxy, credentials);
    await service.initialize();
    await service.updateMinio({
      endpoint: 'http://localhost:9000',
      bucket: 'music-library',
      accessKey: 'key',
      secretKey: 'secret',
      autoSync: false,
    });
    await service.updateMinio({
      endpoint: 'https://minio.example.com',
      bucket: 'music-library',
      accessKey: 'key',
      autoSync: true,
    });
    expect(await service.getMinioConnection()).toMatchObject({
      endpoint: 'https://minio.example.com',
      secretKey: 'secret',
    });

    const cleared = await service.clearMinio();
    expect(cleared.minioConfigured).toBe(false);
    expect(cleared.minioAutoSync).toBe(false);
    expect(await service.getMinioConnection()).toBeUndefined();
  });
});

describe('normalizeMinioEndpoint', () => {
  it('normalizes a host and port to an HTTP origin', () => {
    expect(normalizeMinioEndpoint('minio.example.com:9000')).toBe('http://minio.example.com:9000');
  });

  it('rejects credentials and paths embedded in the endpoint', () => {
    expect(() => normalizeMinioEndpoint('https://user:pass@example.com')).toThrow('账号');
    expect(() => normalizeMinioEndpoint('https://example.com/api')).toThrow('路径');
  });
});
