import { app, BrowserWindow } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import { logger } from './logger';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const rendererDist = app.isPackaged
  ? path.join(process.resourcesPath, 'dist')
  : path.join(__dirname, '../dist');

process.env['DIST'] = rendererDist;
process.env['VITE_PUBLIC'] = app.isPackaged
  ? rendererDist
  : path.join(__dirname, '../../public');

let win: BrowserWindow | null = null;

export function getWindow(): BrowserWindow | null {
  return win;
}

export async function createWindow(): Promise<BrowserWindow> {
  const userDataPath = app.getPath('userData');
  logger.info('=== LYRICS ADAPTER STARTUP ===');
  logger.info('Platform:', process.platform);
  logger.info('User Data Directory:', userDataPath);
  logger.info('===============================');

  const isMacOS = process.platform === 'darwin';
  const isWindows = process.platform === 'win32';

  win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 1080,
    minHeight: 720,
    title: 'LyricsAdapter',
    frame: false,
    transparent: isMacOS || process.platform === 'linux',
    // Mica is the Windows backdrop intended for long-lived app windows. Acrylic
    // continuously samples the desktop like a transient surface and keeps a
    // noticeably larger DWM/GPU working set while the player sits idle.
    ...(isWindows ? { backgroundMaterial: 'mica' as const } : {}),
    ...(isWindows ? { backgroundColor: '#00000000' } : {}),
    ...(isMacOS ? { vibrancy: 'sidebar' as const, visualEffectState: 'active' as const } : {}),
    titleBarStyle: isMacOS ? 'hiddenInset' : 'hidden',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      // sandbox disabled: custom app:// protocol (protocol.handle) is
      // incompatible with OS-level renderer sandbox. contextIsolation
      // provides the security boundary instead.
      sandbox: false
    },
  });

  const session = win.webContents.session;

  const filter = {
    urls: ['https://*.y.qq.com/*', 'https://*.qq.com/*', 'https://*.qqmusic.qq.com/*', 'https://*.gtimg.cn/*']
  };

  session.webRequest.onBeforeSendHeaders(filter, (details, callback) => {
    if (details.requestHeaders) {
      callback({ requestHeaders: details.requestHeaders });
    } else {
      callback({});
    }
  });

  // Single onHeadersReceived listener that injects BOTH CORS headers (for the
  // QQ Music hosts above) and — in packaged builds only — the Content-Security-
  // Policy. Previously these were two separate listeners; the second (CSP,
  // packaged-only, no URL filter) received the ORIGINAL responseHeaders and so
  // silently dropped the CORS headers the first listener had just injected,
  // breaking cross-origin QQ requests in packaged builds. Merging into one
  // callback closes that race. Host matching mirrors the filter pattern set
  // (each entry is https://<glob-host>/*) by suffix-testing against details.url.
  const corsHostSuffixes = ['y.qq.com', 'qq.com', 'qqmusic.qq.com', 'gtimg.cn'];
  session.webRequest.onHeadersReceived((details, callback) => {
    const headers = details.responseHeaders || {};

    let hostname = '';
    try { hostname = new URL(details.url).hostname.toLowerCase(); } catch { /* non-URL: skip CORS */ }
    const isCorsHost = hostname !== '' && corsHostSuffixes.some(suffix => hostname === suffix || hostname.endsWith('.' + suffix));
    if (isCorsHost) {
      headers['Access-Control-Allow-Origin'] = ['*'];
      headers['Access-Control-Allow-Methods'] = ['GET, POST, OPTIONS'];
      headers['Access-Control-Allow-Headers'] = ['Content-Type, Authorization, Cookie, Referer, User-Agent'];
      headers['Access-Control-Allow-Credentials'] = ['true'];
    }

    if (app.isPackaged) {
      const csp = `default-src 'self' app: blob: data:; script-src 'self' app: 'unsafe-inline' 'unsafe-eval' blob: https://esm.sh; style-src 'self' app: 'unsafe-inline' blob: data: https://esm.sh; img-src 'self' app: blob: data: https: http: file: cover: https://*.gtimg.cn; media-src 'self' app: blob: data: file: https: audio: stream:; connect-src 'self' app: blob: data: cover: ws://localhost:* http://localhost:* https://esm.sh https://u.y.qq.com https://y.qq.com https://c.y.qq.com https://shc.y.qq.com https://i.y.qq.com https://dl.stream.qqmusic.qq.com https://webdav.123pan.cn https://*.123pan.cn https://*.baidubce.com https://*.cjjd19.com; worker-src 'self' app: blob:; frame-src 'self' app: blob:; font-src 'self' app: blob: data: https://esm.sh;`;
      headers['Content-Security-Policy'] = [csp];
    }

    callback({ responseHeaders: headers });
  });

  const log = (...args: any[]) => {
    logger.info(...args);
    if (win) {
      win.webContents.executeJavaScript(`console.log(${args.map(a => JSON.stringify(a)).join(', ')})`);
    }
  };

  const serveBuiltRenderer = app.isPackaged || process.env['LYRICS_ADAPTER_E2E_STATIC'] === '1';

  if (serveBuiltRenderer) {
    const appUrl = 'app://localhost/index.html';
    log('Loading URL:', appUrl);

    win.webContents.on('did-finish-load', () => {
      log('Page loaded successfully');
      win?.webContents.executeJavaScript('console.log("React render check:", document.getElementById("root"))');
    });

    win.webContents.on('did-fail-load', (_event, errorCode, errorDescription) => {
      log('Failed to load:', errorCode, errorDescription);
    });

    await win.loadURL(appUrl);
  } else {
    // Dev mode: load from app:// protocol which proxies to Vite dev server.
    // This keeps the origin as app://localhost in both modes so that
    // localStorage and IndexedDB are shared between dev and production.
    const appUrl = 'app://localhost/index.html';
    log('Loading URL (dev via app:// proxy):', appUrl);

    win.webContents.on('did-fail-load', (_event, errorCode, errorDescription) => {
      log('Failed to load via app://:', errorCode, errorDescription);
      log('Make sure Vite dev server is running on http://127.0.0.1:3000');
    });

    await win.loadURL(appUrl);
  }

  win.webContents.on('before-input-event', (_event, input) => {
    if (['Shift', 'Control', 'Alt', 'Meta'].includes(input.key)) {
      return;
    }

    let accelerator = '';
    if (input.control) accelerator += 'Ctrl+';
    if (input.meta) accelerator += 'Cmd+';
    if (input.alt) accelerator += 'Alt+';
    if (input.shift) accelerator += 'Shift+';

    let key = input.key;
    if (key === ' ') key = 'Space';
    if (key === 'ArrowLeft') key = 'Left';
    if (key === 'ArrowRight') key = 'Right';
    if (key === 'ArrowUp') key = 'Up';
    if (key === 'ArrowDown') key = 'Down';

    accelerator += key;

    win?.webContents.send('shortcut-triggered', {
      accelerator,
      key: input.key,
      code: input.code,
      control: input.control,
      meta: input.meta,
      alt: input.alt,
      shift: input.shift
    });
  });

  win.on('closed', () => {
    win = null;
  });

  return win;
}

export function setupAppLifecycle(): void {
  app.on('window-all-closed', () => {
    app.quit();
  });

  app.on('activate', () => {
    if (win === null) {
      createWindow();
    }
  });
}
