import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  app,
  BrowserWindow,
  ipcMain,
  net,
  nativeImage,
  protocol,
  session,
  shell,
  type WebContents,
} from 'electron';
import { IPC_CHANNELS } from '../shared/contracts.js';
import { registerIpcHandlers, removeIpcHandlers } from './ipc.js';
import { LibraryDatabase } from './library/database.js';
import { LibraryService } from './library/service.js';
import { LocalLyricsService } from './local-lyrics/local-lyrics-service.js';
import { resolveLocalLyricsRuntime } from './local-lyrics/runtime.js';
import { PythonWorkerGateway } from './local-lyrics/worker-gateway.js';
import { BilingualLyricsService } from './lyrics/bilingual-lyrics-service.js';
import {
  CodexSdkBilingualTranslator,
  CodexSdkStructuredRunner,
} from './lyrics/codex-bilingual-translator.js';
import { Kid3Adapter } from './lyrics/kid3.js';
import { LyricsOffsetService } from './lyrics/lyrics-offset-service.js';
import { SimplifiedLyricsService } from './lyrics/simplified-lyrics-service.js';
import { LrclibClient } from './lyrics/lrclib.js';
import { OnlineLyricsService } from './lyrics/online-lyrics-service.js';
import { configureLogging, logger } from './logging.js';
import { allowRendererMediaAccess } from './media-response.js';
import { TrackWriteCoordinator } from './track-write-coordinator.js';
import { setImmersiveFullscreenPriority } from './immersive-fullscreen.js';
import { UtilityVisualAnalysisRunner } from './visual-analysis/runner.js';
import { VisualAnalysisService } from './visual-analysis/service.js';
import { TaskNotificationService } from './task-notifications.js';
import { shouldUsePackagedResources } from './runtime-mode.js';
import { AppSettingsService } from './settings/app-settings.js';
import { ElectronCredentialProtector } from './settings/credential-protector.js';
import { GlobalNetworkProxy } from './settings/network-proxy.js';
import { resolveMusicDownloadRuntime } from './music-download/runtime.js';
import { MusicDownloadService } from './music-download/service.js';
import { RemoteSyncService } from './remote-sync/service.js';

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
let mainWindow: BrowserWindow | null = null;
let database: LibraryDatabase | null = null;
let library: LibraryService | null = null;
let onlineLyrics: OnlineLyricsService | null = null;
let localLyrics: LocalLyricsService | null = null;
let bilingualLyrics: BilingualLyricsService | null = null;
let visualAnalysis: VisualAnalysisService | null = null;
let musicDownloads: MusicDownloadService | null = null;
let remoteSync: RemoteSyncService | null = null;
let appSettings: AppSettingsService | null = null;
let playbackFlushRequestSequence = 0;
let quitPlaybackFlushed = false;
let shutdownStarted = false;
const closeAllowedWindows = new WeakSet<BrowserWindow>();
const pendingPlaybackFlushes = new WeakMap<BrowserWindow, Promise<void>>();

function requestPlaybackFlush(window: BrowserWindow): Promise<void> {
  if (window.isDestroyed() || window.webContents.isDestroyed()) return Promise.resolve();
  const existing = pendingPlaybackFlushes.get(window);
  if (existing) return existing;

  const requestId = `${Date.now()}-${++playbackFlushRequestSequence}`;
  const pending = new Promise<void>((resolve) => {
    let timeout: NodeJS.Timeout | undefined;
    let settled = false;
    const finish = (): void => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      ipcMain.removeListener(IPC_CHANNELS.playbackFlushComplete, onComplete);
      resolve();
    };
    const onComplete = (
      event: Electron.IpcMainEvent,
      completedRequestId: unknown,
    ): void => {
      if (event.sender !== window.webContents || completedRequestId !== requestId) return;
      finish();
    };
    ipcMain.on(IPC_CHANNELS.playbackFlushComplete, onComplete);
    timeout = setTimeout(finish, 1_500);
    window.webContents.send(IPC_CHANNELS.playbackFlushRequested, requestId);
  });
  pendingPlaybackFlushes.set(window, pending);
  void pending.finally(() => pendingPlaybackFlushes.delete(window));
  return pending;
}

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'lyralume-media',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
    },
  },
]);

if (process.env.LYRALUME_E2E_USER_DATA) {
  app.setPath('userData', process.env.LYRALUME_E2E_USER_DATA);
}

configureLogging();

if (process.platform === 'win32') app.setAppUserModelId('com.lyralume.player');

function isTrustedNavigation(targetUrl: string): boolean {
  const devServer = process.env.VITE_DEV_SERVER_URL;
  if (devServer && targetUrl.startsWith(devServer)) return true;
  return targetUrl.startsWith('file:');
}

function secureWebContents(webContents: WebContents): void {
  webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url);
    return { action: 'deny' };
  });
  webContents.on('will-navigate', (event, url) => {
    if (!isTrustedNavigation(url)) event.preventDefault();
  });
}

function resolveAppIconPath(): string {
  const fileName = process.platform === 'win32'
    ? 'lyralume-icon.ico'
    : 'lyralume-icon-256.png';
  return shouldUsePackagedResources(app.isPackaged)
    ? path.join(process.resourcesPath, 'branding', fileName)
    : path.join(currentDirectory, '../../assets/branding', fileName);
}

function createWindow(): BrowserWindow {
  const iconPath = resolveAppIconPath();
  const appIcon = nativeImage.createFromPath(iconPath);
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1080,
    minHeight: 680,
    backgroundColor: '#090c12',
    icon: appIcon,
    show: false,
    title: 'Lyralume',
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#090c12',
      symbolColor: '#dde8ff',
      height: 42,
    },
    webPreferences: {
      preload: path.join(currentDirectory, '../preload/index.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
    },
  });
  if (process.platform === 'win32') {
    window.setIcon(appIcon);
    window.setAppDetails({
      appId: 'com.lyralume.player',
      appIconPath: iconPath,
      appIconIndex: 0,
    });
  }
  secureWebContents(window.webContents);
  const notifyFullscreenChanged = (fullscreen: boolean): void => {
    if (!window.webContents.isDestroyed()) {
      window.webContents.send(IPC_CHANNELS.appFullscreenChanged, fullscreen);
    }
  };
  window.on('enter-full-screen', () => {
    setImmersiveFullscreenPriority(window, true);
    notifyFullscreenChanged(true);
  });
  window.on('leave-full-screen', () => {
    setImmersiveFullscreenPriority(window, false);
    notifyFullscreenChanged(false);
  });
  window.once('ready-to-show', () => window.show());
  window.on('close', (event) => {
    if (closeAllowedWindows.has(window) || shutdownStarted) return;
    event.preventDefault();
    void requestPlaybackFlush(window).finally(() => {
      if (window.isDestroyed()) return;
      closeAllowedWindows.add(window);
      window.close();
    });
  });
  window.on('query-session-end', () => {
    void requestPlaybackFlush(window);
  });
  window.on('closed', () => {
    if (mainWindow === window) mainWindow = null;
  });

  const devServer = process.env.VITE_DEV_SERVER_URL;
  if (devServer) void window.loadURL(devServer);
  else void window.loadFile(path.join(currentDirectory, '../../dist-renderer/index.html'));
  return window;
}

function registerMediaProtocol(): void {
  protocol.handle('lyralume-media', async (request) => {
    if (!database) return new Response('Database unavailable', { status: 503 });
    const url = new URL(request.url);
    const id = decodeURIComponent(url.pathname.replace(/^\//, ''));

    if (url.hostname === 'track') {
      if (!/^[a-f0-9]{24}$/.test(id)) return new Response('Not found', { status: 404 });
      const track = database.getTrackLocation(id);
      if (!track || !existsSync(track.filePath)) return new Response('Not found', { status: 404 });
      const response = await net.fetch(pathToFileURL(track.filePath).toString(), {
        headers: request.headers,
      });
      return allowRendererMediaAccess(response);
    }
    if (url.hostname === 'artwork') {
      if (!/^[a-f0-9]{24}$/.test(id)) return new Response('Not found', { status: 404 });
      const artwork = database.getArtwork(id);
      if (!artwork) return new Response('Not found', { status: 404 });
      return allowRendererMediaAccess(new Response(new Uint8Array(artwork.data), {
        headers: {
          'Content-Type': artwork.mime,
          'Cache-Control': 'private, max-age=3600',
        },
      }));
    }
    if (url.hostname === 'task-vocals') {
      const vocalsPath = localLyrics?.getVocalsPath(id);
      if (!vocalsPath || !existsSync(vocalsPath)) return new Response('Not found', { status: 404 });
      const response = await net.fetch(pathToFileURL(vocalsPath).toString(), {
        headers: request.headers,
      });
      return allowRendererMediaAccess(response);
    }
    return new Response('Not found', { status: 404 });
  });
}

async function start(): Promise<void> {
  const userDataPath = app.getPath('userData');
  const usePackagedResources = shouldUsePackagedResources(app.isPackaged);
  appSettings = new AppSettingsService(
    userDataPath,
    path.join(app.getPath('downloads'), 'Lyralume'),
    new GlobalNetworkProxy(session.defaultSession),
    new ElectronCredentialProtector(),
  );
  await appSettings.initialize();
  if (process.env.VITE_DEV_SERVER_URL) {
    try {
      await session.defaultSession.clearCache();
      logger.info('Cleared Electron HTTP cache before loading the development server');
    } catch (error) {
      logger.warn('Unable to clear Electron HTTP cache before development startup', error);
    }
  }
  database = new LibraryDatabase(path.join(userDataPath, 'library.db'));
  const kid3 = new Kid3Adapter(path.join(userDataPath, 'cache', 'kid3'));
  const trackWrites = new TrackWriteCoordinator();
  library = new LibraryService(database, kid3, trackWrites);
  onlineLyrics = new OnlineLyricsService(
    database,
    library,
    new LrclibClient(session.defaultSession.fetch.bind(session.defaultSession) as typeof fetch),
    kid3,
    trackWrites,
  );
  const localRuntime = resolveLocalLyricsRuntime(userDataPath);
  const workerGateway = new PythonWorkerGateway(
    localRuntime.uvrPython,
    localRuntime.whisperPython,
    localRuntime.uvrScript,
    localRuntime.whisperScript,
    undefined,
    (taskId, level, message) => logger.info(`[task:${taskId}] [worker:${level}] ${message}`),
  );
  localLyrics = new LocalLyricsService(
    database,
    library,
    workerGateway,
    kid3,
    localRuntime.options,
    trackWrites,
  );
  bilingualLyrics = new BilingualLyricsService(
    database,
    library,
    kid3,
    new CodexSdkBilingualTranslator(new CodexSdkStructuredRunner({
      packagedResourcesPath: usePackagedResources ? process.resourcesPath : undefined,
    })),
    trackWrites,
  );
  const lyricsOffset = new LyricsOffsetService(database, library, kid3, trackWrites);
  const simplifiedLyrics = new SimplifiedLyricsService(database, library, kid3, trackWrites);
  const bundledFfmpeg = usePackagedResources
    ? path.join(process.resourcesPath, 'tools', 'ffmpeg', 'ffmpeg.exe')
    : path.join(app.getAppPath(), 'tools', 'ffmpeg', 'ffmpeg.exe');
  visualAnalysis = new VisualAnalysisService(
    database,
    new UtilityVisualAnalysisRunner(
      path.join(currentDirectory, 'visual-analysis', 'worker.js'),
      existsSync(bundledFfmpeg)
        ? bundledFfmpeg
        : process.env.LYRALUME_FFMPEG_PATH || 'ffmpeg',
    ),
  );
  const musicRuntime = resolveMusicDownloadRuntime({
    appPath: app.getAppPath(),
    resourcesPath: process.resourcesPath,
    packaged: usePackagedResources,
  });
  musicDownloads = new MusicDownloadService(
    appSettings,
    musicRuntime,
    path.join(userDataPath, 'cache', 'music-downloads'),
    (filePath) => {
      if (database?.ignoreFileForAutomaticScan(filePath)) library?.refreshSnapshot();
    },
  );
  remoteSync = new RemoteSyncService(database, appSettings, trackWrites);
  registerMediaProtocol();
  const taskNotifications = new TaskNotificationService(database, () => mainWindow);
  registerIpcHandlers(
    () => mainWindow,
    database,
    library,
    onlineLyrics,
    localLyrics,
    bilingualLyrics,
    lyricsOffset,
    simplifiedLyrics,
    visualAnalysis,
    taskNotifications,
    appSettings,
    musicDownloads,
    remoteSync,
  );
  mainWindow = createWindow();
  await library.initializeWatchers();
  const initialLibrary = library.getSnapshot();
  visualAnalysis.scheduleLibrary(initialLibrary.tracks);
  await remoteSync.initialize(initialLibrary);

  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({ responseHeaders: details.responseHeaders });
  });
}

process.on('uncaughtException', (error) => logger.error('Uncaught main-process error', error));
process.on('unhandledRejection', (error) => logger.error('Unhandled main-process rejection', error));

const hasLock = app.requestSingleInstanceLock();
if (!hasLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app.whenReady().then(start).catch((error) => {
    logger.error('Application startup failed', error);
    app.quit();
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) mainWindow = createWindow();
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', (event) => {
  if (!quitPlaybackFlushed && mainWindow && !mainWindow.isDestroyed()) {
    event.preventDefault();
    void requestPlaybackFlush(mainWindow).finally(() => {
      quitPlaybackFlushed = true;
      app.quit();
    });
    return;
  }
  if (!library || !database) return;
  event.preventDefault();
  if (shutdownStarted) return;
  shutdownStarted = true;
  const activeLibrary = library;
  const activeDatabase = database;
  const activeLocalLyrics = localLyrics;
  const activeBilingualLyrics = bilingualLyrics;
  const activeVisualAnalysis = visualAnalysis;
  const activeMusicDownloads = musicDownloads;
  const activeRemoteSync = remoteSync;
  library = null;
  database = null;
  onlineLyrics = null;
  localLyrics = null;
  bilingualLyrics = null;
  visualAnalysis = null;
  musicDownloads = null;
  remoteSync = null;
  appSettings = null;
  void Promise.all([
    activeLibrary.close(),
    activeLocalLyrics?.close(),
    activeBilingualLyrics?.close(),
    activeVisualAnalysis?.close(),
    activeMusicDownloads?.close(),
    activeRemoteSync?.close(),
  ]).finally(() => {
    removeIpcHandlers();
    activeDatabase.close();
    app.exit(0);
  });
});
