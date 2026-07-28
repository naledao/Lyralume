import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type {
  AppSettingsSnapshot,
  MinioConnectionSettings,
  MinioSettingsUpdate,
  ProxySettingsUpdate,
} from '../../shared/contracts.js';
import { normalizeProxyUrl } from './network-proxy.js';
import type { CredentialProtector } from './credential-protector.js';

const MAX_COOKIE_FILE_BYTES = 10 * 1024 * 1024;

interface StoredSettings {
  downloadDirectory: string;
  proxyEnabled: boolean;
  proxyUrl: string;
  cookieFileName?: string;
  cookieUpdatedAt?: number;
  minioEndpoint: string;
  minioBucket: string;
  minioAccessKey: string;
  minioAutoSync: boolean;
}

export interface NetworkProxyApplier {
  apply(proxyUrl?: string): Promise<void>;
}

function validStoredSettings(value: unknown): value is Partial<StoredSettings> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function normalizeMinioEndpoint(rawValue: string): string {
  const trimmed = rawValue.trim();
  if (!trimmed) throw new Error('必须填写 MinIO API 地址');
  let parsed: URL;
  try {
    parsed = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`);
  } catch {
    throw new Error('MinIO API 地址格式不正确');
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('MinIO API 只支持 HTTP 或 HTTPS');
  }
  if (
    !parsed.hostname
    || parsed.username
    || parsed.password
    || (parsed.pathname && parsed.pathname !== '/')
    || parsed.search
    || parsed.hash
  ) throw new Error('MinIO API 地址不能包含账号、路径、查询参数或片段');
  return parsed.origin;
}

function normalizeMinioBucket(rawValue: string): string {
  const bucket = rawValue.trim();
  if (
    bucket.length < 3
    || bucket.length > 63
    || !/^[a-z0-9][a-z0-9.-]*[a-z0-9]$/.test(bucket)
    || bucket.includes('..')
  ) throw new Error('MinIO Bucket 名称格式不正确');
  return bucket;
}

function normalizeAccessKey(rawValue: string): string {
  const accessKey = rawValue.trim();
  if (!accessKey || accessKey.length > 256 || /[\0\r\n]/.test(accessKey)) {
    throw new Error('MinIO Access Key 格式不正确');
  }
  return accessKey;
}

export class AppSettingsService {
  private readonly settingsDirectory: string;
  private readonly settingsPath: string;
  private readonly cookiePath: string;
  private readonly minioSecretPath: string;
  private settings: StoredSettings;

  constructor(
    userDataPath: string,
    defaultDownloadDirectory: string,
    private readonly proxy: NetworkProxyApplier,
    private readonly credentials?: CredentialProtector,
  ) {
    this.settingsDirectory = path.join(userDataPath, 'settings');
    this.settingsPath = path.join(this.settingsDirectory, 'app-settings.json');
    this.cookiePath = path.join(this.settingsDirectory, 'youtube-cookies.txt');
    this.minioSecretPath = path.join(this.settingsDirectory, 'minio-secret.bin');
    this.settings = {
      downloadDirectory: path.resolve(defaultDownloadDirectory),
      proxyEnabled: false,
      proxyUrl: '',
      minioEndpoint: '',
      minioBucket: '',
      minioAccessKey: '',
      minioAutoSync: false,
    };
  }

  async initialize(): Promise<AppSettingsSnapshot> {
    await mkdir(this.settingsDirectory, { recursive: true });
    try {
      const parsed: unknown = JSON.parse(await readFile(this.settingsPath, 'utf8'));
      if (validStoredSettings(parsed)) {
        if (typeof parsed.downloadDirectory === 'string' && parsed.downloadDirectory.trim()) {
          this.settings.downloadDirectory = path.resolve(parsed.downloadDirectory.trim());
        }
        if (typeof parsed.proxyUrl === 'string' && parsed.proxyUrl.trim()) {
          try {
            this.settings.proxyUrl = normalizeProxyUrl(parsed.proxyUrl);
          } catch {
            this.settings.proxyUrl = '';
          }
        }
        this.settings.proxyEnabled = parsed.proxyEnabled === true && Boolean(this.settings.proxyUrl);
        if (typeof parsed.cookieFileName === 'string' && parsed.cookieFileName.trim()) {
          this.settings.cookieFileName = path.basename(parsed.cookieFileName.trim());
        }
        if (typeof parsed.cookieUpdatedAt === 'number' && Number.isFinite(parsed.cookieUpdatedAt)) {
          this.settings.cookieUpdatedAt = parsed.cookieUpdatedAt;
        }
        try {
          if (
            typeof parsed.minioEndpoint === 'string'
            && typeof parsed.minioBucket === 'string'
            && typeof parsed.minioAccessKey === 'string'
            && parsed.minioEndpoint.trim()
            && parsed.minioBucket.trim()
            && parsed.minioAccessKey.trim()
          ) {
            this.settings.minioEndpoint = normalizeMinioEndpoint(parsed.minioEndpoint);
            this.settings.minioBucket = normalizeMinioBucket(parsed.minioBucket);
            this.settings.minioAccessKey = normalizeAccessKey(parsed.minioAccessKey);
          }
        } catch {
          this.settings.minioEndpoint = '';
          this.settings.minioBucket = '';
          this.settings.minioAccessKey = '';
        }
        this.settings.minioAutoSync = parsed.minioAutoSync === true;
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw new Error('应用设置文件损坏或无法读取');
      }
    }
    if (!(await this.hasMinioSecret()) || !this.hasMinioIdentity()) {
      this.settings.minioAutoSync = false;
    }
    await this.proxy.apply(this.settings.proxyEnabled ? this.settings.proxyUrl : undefined);
    return this.getSnapshot();
  }

  async getSnapshot(): Promise<AppSettingsSnapshot> {
    const cookieConfigured = await this.hasCookieFile();
    const minioSecretConfigured = await this.hasMinioSecret();
    const minioConfigured = this.hasMinioIdentity() && minioSecretConfigured;
    return {
      downloadDirectory: this.settings.downloadDirectory,
      proxyEnabled: this.settings.proxyEnabled,
      proxyUrl: this.settings.proxyUrl,
      cookieConfigured,
      cookieFileName: cookieConfigured ? this.settings.cookieFileName : undefined,
      cookieUpdatedAt: cookieConfigured ? this.settings.cookieUpdatedAt : undefined,
      minioEndpoint: this.settings.minioEndpoint,
      minioBucket: this.settings.minioBucket,
      minioAccessKey: this.settings.minioAccessKey,
      minioSecretConfigured,
      minioConfigured,
      minioAutoSync: minioConfigured && this.settings.minioAutoSync,
    };
  }

  getDownloadDirectory(): string {
    return this.settings.downloadDirectory;
  }

  getProxyUrl(): string | undefined {
    return this.settings.proxyEnabled ? this.settings.proxyUrl : undefined;
  }

  async getCookiePath(): Promise<string | undefined> {
    return await this.hasCookieFile() ? this.cookiePath : undefined;
  }

  async setDownloadDirectory(directoryPath: string): Promise<AppSettingsSnapshot> {
    const resolved = path.resolve(directoryPath.trim());
    if (!resolved || path.parse(resolved).root === resolved) {
      throw new Error('不能把磁盘根目录设置为下载目录');
    }
    const metadata = await stat(resolved);
    if (!metadata.isDirectory()) throw new Error('下载目录不是有效文件夹');
    this.settings.downloadDirectory = resolved;
    await this.persist();
    return this.getSnapshot();
  }

  async updateProxy(update: ProxySettingsUpdate): Promise<AppSettingsSnapshot> {
    const normalized = update.enabled ? normalizeProxyUrl(update.url) : update.url.trim()
      ? normalizeProxyUrl(update.url)
      : '';
    await this.proxy.apply(update.enabled ? normalized : undefined);
    this.settings.proxyEnabled = update.enabled;
    this.settings.proxyUrl = normalized;
    await this.persist();
    return this.getSnapshot();
  }

  async updateMinio(update: MinioSettingsUpdate): Promise<AppSettingsSnapshot> {
    const endpoint = normalizeMinioEndpoint(update.endpoint);
    const bucket = normalizeMinioBucket(update.bucket);
    const accessKey = normalizeAccessKey(update.accessKey);
    const secretKey = update.secretKey ?? '';
    if (secretKey.length > 512 || /[\0\r\n]/.test(secretKey)) {
      throw new Error('MinIO Secret Key 格式不正确');
    }
    if (!secretKey && !(await this.hasMinioSecret())) {
      throw new Error('必须填写 MinIO Secret Key');
    }
    if (secretKey) await this.writeMinioSecret(secretKey);
    this.settings.minioEndpoint = endpoint;
    this.settings.minioBucket = bucket;
    this.settings.minioAccessKey = accessKey;
    this.settings.minioAutoSync = update.autoSync;
    await this.persist();
    return this.getSnapshot();
  }

  async clearMinio(): Promise<AppSettingsSnapshot> {
    await rm(this.minioSecretPath, { force: true });
    this.settings.minioEndpoint = '';
    this.settings.minioBucket = '';
    this.settings.minioAccessKey = '';
    this.settings.minioAutoSync = false;
    await this.persist();
    return this.getSnapshot();
  }

  async getMinioConnection(): Promise<MinioConnectionSettings | undefined> {
    if (!this.hasMinioIdentity() || !(await this.hasMinioSecret())) return undefined;
    if (!this.credentials || !(await this.credentials.isAvailable())) {
      throw new Error('当前系统无法安全解密 MinIO 凭据');
    }
    const secretKey = await this.credentials.decrypt(await readFile(this.minioSecretPath));
    if (!secretKey) throw new Error('MinIO Secret Key 无法读取');
    return {
      endpoint: this.settings.minioEndpoint,
      bucket: this.settings.minioBucket,
      accessKey: this.settings.minioAccessKey,
      secretKey,
    };
  }

  isMinioAutoSyncEnabled(): boolean {
    return this.settings.minioAutoSync && this.hasMinioIdentity();
  }

  async importCookieFile(sourcePath: string): Promise<AppSettingsSnapshot> {
    const source = await readFile(sourcePath);
    if (source.byteLength === 0 || source.byteLength > MAX_COOKIE_FILE_BYTES) {
      throw new Error('Cookie 文件为空或超过 10 MB');
    }
    const header = source.subarray(0, Math.min(source.byteLength, 256)).toString('utf8');
    const firstLine = header.split(/\r?\n/, 1)[0]?.trim();
    if (firstLine !== '# HTTP Cookie File' && firstLine !== '# Netscape HTTP Cookie File') {
      throw new Error('Cookie 文件必须是 Netscape cookies.txt 格式');
    }
    const tempPath = `${this.cookiePath}.${process.pid}.${Date.now()}.tmp`;
    try {
      await writeFile(tempPath, source, { flag: 'wx' });
      await rename(tempPath, this.cookiePath);
    } finally {
      await rm(tempPath, { force: true }).catch(() => undefined);
    }
    this.settings.cookieFileName = path.basename(sourcePath);
    this.settings.cookieUpdatedAt = Date.now();
    await this.persist();
    return this.getSnapshot();
  }

  async clearCookie(): Promise<AppSettingsSnapshot> {
    await rm(this.cookiePath, { force: true });
    delete this.settings.cookieFileName;
    delete this.settings.cookieUpdatedAt;
    await this.persist();
    return this.getSnapshot();
  }

  private async hasCookieFile(): Promise<boolean> {
    try {
      return (await stat(this.cookiePath)).isFile();
    } catch {
      return false;
    }
  }

  private hasMinioIdentity(): boolean {
    return Boolean(
      this.settings.minioEndpoint
      && this.settings.minioBucket
      && this.settings.minioAccessKey,
    );
  }

  private async hasMinioSecret(): Promise<boolean> {
    try {
      return (await stat(this.minioSecretPath)).isFile();
    } catch {
      return false;
    }
  }

  private async writeMinioSecret(secretKey: string): Promise<void> {
    if (!this.credentials || !(await this.credentials.isAvailable())) {
      throw new Error('当前系统无法安全保存 MinIO 凭据');
    }
    const encrypted = await this.credentials.encrypt(secretKey);
    const tempPath = `${this.minioSecretPath}.${process.pid}.${Date.now()}.tmp`;
    try {
      await writeFile(tempPath, encrypted, { flag: 'wx' });
      await rename(tempPath, this.minioSecretPath);
    } finally {
      await rm(tempPath, { force: true }).catch(() => undefined);
    }
  }

  private async persist(): Promise<void> {
    await mkdir(this.settingsDirectory, { recursive: true });
    const tempPath = `${this.settingsPath}.${process.pid}.${Date.now()}.tmp`;
    try {
      await writeFile(tempPath, `${JSON.stringify(this.settings, null, 2)}\n`, {
        encoding: 'utf8',
        flag: 'wx',
      });
      await rename(tempPath, this.settingsPath);
    } finally {
      await rm(tempPath, { force: true }).catch(() => undefined);
    }
  }
}
