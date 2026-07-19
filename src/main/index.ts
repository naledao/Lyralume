import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  app,
  BrowserWindow,
  net,
  protocol,
  session,
  shell,
  type WebContents,
} from 'electron';
import { registerIpcHandlers, removeIpcHandlers } from './ipc.js';
import { LibraryDatabase } from './library/database.js';
import { LibraryService } from './library/service.js';
import { LocalLyricsService } from './local-lyrics/local-lyrics-service.js';
import { resolveLocalLyricsRuntime } from './local-lyrics/runtime.js';
import { PythonWorkerGateway } from './local-lyrics/worker-gateway.js';
import { Kid3Adapter } from './lyrics/kid3.js';
import { LyricsOffsetService } from './lyrics/lyrics-offset-service.js';
import { LrclibClient } from './lyrics/lrclib.js';
import { OnlineLyricsService } from './lyrics/online-lyrics-service.js';
import { configureLogging, logger } from './logging.js';
import { allowRendererMediaAccess } from './media-response.js';
import { TrackWriteCoordinator } from './track-write-coordinator.js';

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
let mainWindow: BrowserWindow | null = null;
let database: LibraryDatabase | null = null;
let library: LibraryService | null = null;
let onlineLyrics: OnlineLyricsService | null = null;
let localLyrics: LocalLyricsService | null = null;

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

configureLogging();

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

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1080,
    minHeight: 680,
    backgroundColor: '#090c12',
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
  secureWebContents(window.webContents);
  window.once('ready-to-show', () => window.show());
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
      return new Response(new Uint8Array(artwork.data), {
        headers: {
          'Content-Type': artwork.mime,
          'Cache-Control': 'private, max-age=3600',
        },
      });
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
  const userDataPath = process.env.LYRALUME_E2E_USER_DATA || app.getPath('userData');
  database = new LibraryDatabase(path.join(userDataPath, 'library.db'));
  const kid3 = new Kid3Adapter(path.join(userDataPath, 'cache', 'kid3'));
  const trackWrites = new TrackWriteCoordinator();
  library = new LibraryService(database, kid3, trackWrites);
  onlineLyrics = new OnlineLyricsService(
    database,
    library,
    new LrclibClient(),
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
  const lyricsOffset = new LyricsOffsetService(database, library, kid3, trackWrites);
  registerMediaProtocol();
  registerIpcHandlers(
    () => mainWindow,
    database,
    library,
    onlineLyrics,
    localLyrics,
    lyricsOffset,
  );
  mainWindow = createWindow();
  await library.initializeWatchers();

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
  if (!library || !database) return;
  event.preventDefault();
  const activeLibrary = library;
  const activeDatabase = database;
  const activeLocalLyrics = localLyrics;
  library = null;
  database = null;
  onlineLyrics = null;
  localLyrics = null;
  void Promise.all([activeLibrary.close(), activeLocalLyrics?.close()]).finally(() => {
    removeIpcHandlers();
    activeDatabase.close();
    app.exit(0);
  });
});
