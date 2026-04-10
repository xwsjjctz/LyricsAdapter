import { app, BrowserWindow } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import { logger } from './logger';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

process.env.DIST = path.join(__dirname, '../dist');
process.env.VITE_PUBLIC = app.isPackaged
  ? process.env.DIST
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

  win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 1080,
    minHeight: 720,
    title: 'LyricsAdapter',
    frame: false,
    titleBarStyle: isMacOS ? 'hiddenInset' : 'hidden',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      sandbox: true
    },
  });

  const session = win.webContents.session;

  const filter = {
    urls: ['https://*.y.qq.com/*', 'https://*.qq.com/*', 'https://*.qqmusic.qq.com/*']
  };

  session.webRequest.onBeforeSendHeaders(filter, (details, callback) => {
    if (details.requestHeaders) {
      callback({ requestHeaders: details.requestHeaders });
    } else {
      callback({});
    }
  });

  session.webRequest.onHeadersReceived(filter, (details, callback) => {
    const headers = details.responseHeaders || {};

    headers['Access-Control-Allow-Origin'] = ['*'];
    headers['Access-Control-Allow-Methods'] = ['GET, POST, OPTIONS'];
    headers['Access-Control-Allow-Headers'] = ['Content-Type, Authorization, Cookie, Referer, User-Agent'];
    headers['Access-Control-Allow-Credentials'] = ['true'];

    callback({ responseHeaders: headers });
  });

  if (app.isPackaged) {
    session.webRequest.onHeadersReceived((details, callback) => {
      const csp = `default-src 'self' blob: data:; script-src 'self' 'unsafe-inline' 'unsafe-eval' blob: https://esm.sh; style-src 'self' 'unsafe-inline' blob: data: https://esm.sh; img-src 'self' blob: data: https: http: file: cover: https://*.gtimg.cn; media-src 'self' blob: data: file: https:; connect-src 'self' blob: data: ws://localhost:* http://localhost:* https://esm.sh https://u.y.qq.com https://y.qq.com https://c.y.qq.com https://shc.y.qq.com https://i.y.qq.com https://dl.stream.qqmusic.qq.com https://webdav.123pan.cn https://*.123pan.cn https://*.baidubce.com https://*.cjjd19.com; worker-src 'self' blob:; frame-src 'self' blob:; font-src 'self' blob: data: https://esm.sh;`;
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy': [csp]
        }
      });
    });
  }

  const log = (...args: any[]) => {
    logger.info(...args);
    if (win) {
      win.webContents.executeJavaScript(`logger.info(${args.map(a => JSON.stringify(a)).join(', ')})`);
    }
  };

  if (app.isPackaged) {
    const htmlPath = path.join(__dirname, '../../dist/index.html');
    log('Loading HTML from:', htmlPath);
    log('__dirname:', __dirname);

    const fs = await import('fs');
    log('HTML file exists:', fs.existsSync(htmlPath));

    win.webContents.on('did-finish-load', () => {
      log('Page loaded successfully');
      win?.webContents.executeJavaScript('logger.info("React render check:", document.getElementById("root"))');
    });

    win.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
      log('Failed to load:', errorCode, errorDescription);
    });

    const fileUrl = `file://${htmlPath}`;
    log('Loading URL:', fileUrl);
    await win.loadURL(fileUrl);
  } else {
    win.loadURL('http://localhost:3000');
  }

  win.webContents.on('before-input-event', (event, input) => {
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
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });

  app.on('activate', () => {
    if (win === null) {
      createWindow();
    }
  });
}