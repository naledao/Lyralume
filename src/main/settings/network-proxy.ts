import type { Session } from 'electron';

const PROXY_ENV_KEYS = [
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'ALL_PROXY',
  'http_proxy',
  'https_proxy',
  'all_proxy',
] as const;

export function normalizeProxyUrl(rawValue: string): string {
  const trimmed = rawValue.trim();
  if (!trimmed) throw new Error('启用代理时必须填写代理地址');
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)
    ? trimmed
    : `http://${trimmed}`;
  let parsed: URL;
  try {
    parsed = new URL(withScheme);
  } catch {
    throw new Error('代理地址格式不正确');
  }
  if (!['http:', 'https:', 'socks4:', 'socks5:'].includes(parsed.protocol)) {
    throw new Error('代理仅支持 HTTP、HTTPS、SOCKS4 或 SOCKS5');
  }
  if (!parsed.hostname || !parsed.port) throw new Error('代理地址必须包含主机和端口');
  if (parsed.username || parsed.password) throw new Error('当前版本暂不支持需要账号密码的代理');
  if (!['', '/'].includes(parsed.pathname) || parsed.search || parsed.hash) {
    throw new Error('代理地址不能包含路径、查询参数或片段');
  }
  return `${parsed.protocol}//${parsed.host}`;
}

export class GlobalNetworkProxy {
  private readonly originalEnvironment = new Map<string, string | undefined>();

  constructor(private readonly electronSession: Session) {
    for (const key of PROXY_ENV_KEYS) this.originalEnvironment.set(key, process.env[key]);
  }

  async apply(proxyUrl?: string): Promise<void> {
    await this.electronSession.setProxy(proxyUrl
      ? { mode: 'fixed_servers', proxyRules: proxyUrl }
      : { mode: 'direct' });

    for (const key of PROXY_ENV_KEYS) {
      if (proxyUrl) process.env[key] = proxyUrl;
      else {
        const original = this.originalEnvironment.get(key);
        if (original === undefined) delete process.env[key];
        else process.env[key] = original;
      }
    }

    await this.electronSession.closeAllConnections().catch(() => undefined);
    await this.electronSession.clearHostResolverCache().catch(() => undefined);
  }
}
