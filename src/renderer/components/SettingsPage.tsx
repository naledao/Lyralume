import { useEffect, useState } from 'react';
import type { AppSettingsSnapshot, MusicRuntimeSnapshot } from '../../shared/contracts';
import { Icon } from './Icon';

export function SettingsPage() {
  const [settings, setSettings] = useState<AppSettingsSnapshot | null>(null);
  const [runtime, setRuntime] = useState<MusicRuntimeSnapshot | null>(null);
  const [proxyEnabled, setProxyEnabled] = useState(false);
  const [proxyUrl, setProxyUrl] = useState('');
  const [minioEndpoint, setMinioEndpoint] = useState('');
  const [minioBucket, setMinioBucket] = useState('');
  const [minioAccessKey, setMinioAccessKey] = useState('');
  const [minioSecretKey, setMinioSecretKey] = useState('');
  const [minioAutoSync, setMinioAutoSync] = useState(false);
  const [busy, setBusy] = useState<string | null>('loading');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const applySettings = (next: AppSettingsSnapshot): void => {
    setSettings(next);
    setProxyEnabled(next.proxyEnabled);
    setProxyUrl(next.proxyUrl);
    setMinioEndpoint(next.minioEndpoint);
    setMinioBucket(next.minioBucket);
    setMinioAccessKey(next.minioAccessKey);
    setMinioAutoSync(next.minioAutoSync);
  };

  useEffect(() => {
    void Promise.all([window.lyralume.settings.get(), window.lyralume.music.getRuntime()])
      .then(([loadedSettings, loadedRuntime]) => {
        applySettings(loadedSettings);
        setRuntime(loadedRuntime);
      })
      .catch((loadError) => setError(loadError instanceof Error ? loadError.message : '设置加载失败'))
      .finally(() => setBusy(null));
  }, []);

  const run = async (name: string, operation: () => Promise<AppSettingsSnapshot | null>, success: string): Promise<void> => {
    setBusy(name);
    setError(null);
    setMessage(null);
    try {
      const next = await operation();
      if (next) {
        applySettings(next);
        setMessage(success);
      }
    } catch (operationError) {
      setError(operationError instanceof Error ? operationError.message : '设置保存失败');
    } finally {
      setBusy(null);
    }
  };

  const testMinio = async (): Promise<void> => {
    setBusy('minio-test');
    setError(null);
    setMessage(null);
    try {
      const result = await window.lyralume.remote.testConnection();
      setMessage(result.message);
    } catch (testError) {
      setError(testError instanceof Error ? testError.message : 'MinIO 连接测试失败');
    } finally {
      setBusy(null);
    }
  };

  return (
    <main className="settings-page">
      <header className="settings-page__heading">
        <div>
          <span className="eyebrow">APPLICATION SETTINGS</span>
          <h2>设置</h2>
          <p>下载目录、网络代理、MinIO 同步与 YouTube Cookie 均由本机管理。</p>
        </div>
      </header>

      {error && <div className="settings-page__error" role="alert">{error}</div>}
      {message && <div className="settings-page__message" role="status">{message}</div>}

      <div className="settings-sections">
        <section className="settings-card">
          <header><Icon name="folder" /><div><h3>下载目录</h3><p>MP3 下载完成后保存在这里，不自动加入音乐库。</p></div></header>
          <div className="settings-path"><code>{settings?.downloadDirectory ?? '正在读取…'}</code></div>
          <button
            type="button"
            disabled={Boolean(busy)}
            onClick={() => void run('directory', window.lyralume.settings.chooseDownloadDirectory, '下载目录已更新')}
          >选择目录</button>
        </section>

        <section className="settings-card">
          <header><Icon name="settings" /><div><h3>全局代理</h3><p>应用联网请求和之后启动的 Worker、yt-dlp 与 Codex 进程统一使用该代理。</p></div></header>
          <label className="settings-check">
            <input type="checkbox" checked={proxyEnabled} onChange={(event) => setProxyEnabled(event.currentTarget.checked)} />
            <span>启用代理</span>
          </label>
          <label className="settings-field">
            <span>代理地址</span>
            <input
              value={proxyUrl}
              onChange={(event) => setProxyUrl(event.currentTarget.value)}
              placeholder="http://127.0.0.1:7890"
              disabled={!proxyEnabled}
              spellCheck={false}
            />
          </label>
          <small>支持 HTTP、HTTPS、SOCKS4 和 SOCKS5；当前不支持代理账号密码。</small>
          <button
            type="button"
            disabled={Boolean(busy) || (proxyEnabled && !proxyUrl.trim())}
            onClick={() => void run(
              'proxy',
              () => window.lyralume.settings.updateProxy({ enabled: proxyEnabled, url: proxyUrl }),
              proxyEnabled ? '全局代理已启用' : '全局代理已关闭',
            )}
          >保存代理设置</button>
        </section>

        <section className="settings-card">
          <header><Icon name="download" /><div><h3>YouTube Cookie</h3><p>用于登录校验、年龄限制或反机器人验证，仅向本机 yt-dlp 提供。</p></div></header>
          <div className="settings-cookie" data-configured={settings?.cookieConfigured === true}>
            <strong>{settings?.cookieConfigured ? '已配置' : '未配置'}</strong>
            <span>{settings?.cookieFileName ?? '请选择 Netscape 格式的 cookies.txt'}</span>
          </div>
          <small>Cookie 可能包含登录凭据。Lyralume 会复制到用户数据目录，不在界面读取或显示其内容。</small>
          <div className="settings-actions">
            <button
              type="button"
              disabled={Boolean(busy)}
              onClick={() => void run('cookie', window.lyralume.settings.chooseCookieFile, 'YouTube Cookie 已更新')}
            >选择 Cookie</button>
            <button
              type="button"
              disabled={Boolean(busy) || !settings?.cookieConfigured}
              onClick={() => void run('cookie-clear', () => window.lyralume.settings.clearCookie(), 'YouTube Cookie 已清除')}
            >清除</button>
          </div>
        </section>

        <section className="settings-card settings-card--minio">
          <header><Icon name="cloud" /><div><h3>MinIO 音乐同步</h3><p>使用 MinIO 账号密码连接 S3 兼容 API；密码通过 Windows DPAPI 加密保存，不会返回界面。</p></div></header>
          <div className="settings-minio-grid">
            <label className="settings-field">
              <span>API 地址</span>
              <input
                value={minioEndpoint}
                onChange={(event) => setMinioEndpoint(event.currentTarget.value)}
                placeholder="https://minio.example.com:9000"
                spellCheck={false}
              />
            </label>
            <label className="settings-field">
              <span>Bucket（不存在时自动创建）</span>
              <input
                value={minioBucket}
                onChange={(event) => setMinioBucket(event.currentTarget.value)}
                placeholder="lyralume-music"
                spellCheck={false}
              />
            </label>
            <label className="settings-field">
              <span>用户名（Access Key）</span>
              <input
                value={minioAccessKey}
                onChange={(event) => setMinioAccessKey(event.currentTarget.value)}
                placeholder="请输入 MinIO 用户名"
                autoComplete="username"
                spellCheck={false}
              />
            </label>
            <label className="settings-field">
              <span>密码（Secret Key）</span>
              <input
                type="password"
                value={minioSecretKey}
                onChange={(event) => setMinioSecretKey(event.currentTarget.value)}
                placeholder={settings?.minioSecretConfigured ? '密码已安全保存；留空表示不修改' : '请输入 MinIO 密码'}
                autoComplete="current-password"
                spellCheck={false}
              />
            </label>
          </div>
          <label className="settings-check">
            <input
              type="checkbox"
              checked={minioAutoSync}
              onChange={(event) => setMinioAutoSync(event.currentTarget.checked)}
            />
            <span>自动同步当前音乐库中尚未上传或已经修改的歌曲</span>
          </label>
          {minioEndpoint.trim().toLocaleLowerCase().startsWith('http://') && (
            <small className="settings-warning">当前地址使用未加密 HTTP。公网同步会暴露音频内容和对象信息，建议先配置 HTTPS。</small>
          )}
          <div className="settings-actions">
            <button
              type="button"
              disabled={Boolean(busy) || !minioEndpoint.trim() || !minioBucket.trim() || !minioAccessKey.trim()}
              onClick={() => void run(
                'minio-save',
                async () => {
                  const next = await window.lyralume.settings.updateMinio({
                    endpoint: minioEndpoint,
                    bucket: minioBucket,
                    accessKey: minioAccessKey,
                    secretKey: minioSecretKey || undefined,
                    autoSync: minioAutoSync,
                  });
                  setMinioSecretKey('');
                  return next;
                },
                'MinIO 设置已保存',
              )}
            >保存同步设置</button>
            <button
              type="button"
              disabled={Boolean(busy) || !settings?.minioConfigured}
              onClick={() => void testMinio()}
            >测试连接</button>
            <button
              type="button"
              disabled={Boolean(busy) || !settings?.minioConfigured}
              onClick={() => {
                if (!window.confirm('清除本机保存的 MinIO 设置和凭据？远端歌曲不会被删除。')) return;
                void run('minio-clear', window.lyralume.settings.clearMinio, 'MinIO 设置已清除');
              }}
            >清除</button>
          </div>
        </section>

        <section className="settings-card settings-card--runtime">
          <header><Icon name="tasks" /><div><h3>本地下载运行时</h3><p>搜索由 yt-dlp 完成，320 kbps MP3 转换由 FFmpeg 完成。</p></div></header>
          <div className="runtime-row"><span>yt-dlp</span><strong data-ready={runtime?.ytDlpAvailable === true}>{runtime?.ytDlpAvailable ? '可用' : '缺失'}</strong><code>{runtime?.ytDlpPath ?? '正在检测…'}</code></div>
          <div className="runtime-row"><span>FFmpeg</span><strong data-ready={runtime?.ffmpegAvailable === true}>{runtime?.ffmpegAvailable ? '可用' : '缺失'}</strong><code>{runtime?.ffmpegPath ?? '正在检测…'}</code></div>
        </section>
      </div>
    </main>
  );
}
