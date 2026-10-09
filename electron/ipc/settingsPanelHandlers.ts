import { BrowserWindow, ipcMain, shell, type WebContents } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { loadMacosSettingsGlassBridge } from '../native/macosFocusGlassNative';
import { logger } from '../logger';
import { fail, ok } from './typedResult';

const sectionSchema = z.enum(['general', 'plugins', 'online', 'cloud', 'focus', 'shortcuts']);
const heightSchema = z.number().finite().min(1).max(10000);
const shortcutSchema = z.object({ key: z.string().min(1).max(64), modifiers: z.number().int().min(0).max(15) });

/** A transparent settings renderer over the same AppKit material as Cmd+K. */
export function registerSettingsPanelHandlers(load = loadMacosSettingsGlassBridge, platform = process.platform): void {
  let panel: BrowserWindow | null = null;
  let parent: BrowserWindow | null = null;
  let owner: WebContents | null = null;
  let contentHeight = 600;
  let resolveReady: (() => void) | undefined;

  const layout = () => {
    if (!panel || !parent || panel.isDestroyed() || parent.isDestroyed()) return;
    const bounds = parent.getContentBounds();
    const width = Math.max(1, Math.min(720, bounds.width - 48));
    const height = Math.max(1, Math.min(contentHeight, bounds.height - 176));
    panel.setBounds({ x: bounds.x + Math.floor((bounds.width - width) / 2), y: bounds.y + 56, width, height });
  };
  const close = () => { if (panel && !panel.isDestroyed()) panel.destroy(); };
  const ownerClosed = () => close();

  ipcMain.handle('ipc:settingsPanel:open', async (event, payload: unknown) => {
    if (platform !== 'darwin' || process.env['LYRICS_ADAPTER_DISABLE_NATIVE_GLASS'] === '1') return ok(false);
    const section = sectionSchema.safeParse(payload);
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!section.success || !win || win.getParentWindow() || event.senderFrame !== event.sender.mainFrame) return fail('Invalid settings request');
    if (panel) {
      if (owner !== event.sender) return fail('Settings panel already owned');
      panel.webContents.send('settings-panel-section', section.data);
      return ok(true);
    }
    let openedPanel: BrowserWindow | null = null;
    try {
      const native = load();
      if (!native) return ok(false);
      parent = win; owner = event.sender; contentHeight = 600;
      const child = new BrowserWindow({
        parent: win, show: false, frame: false, transparent: true,
        resizable: false, minimizable: false, maximizable: false, fullscreenable: false,
        skipTaskbar: true, hasShadow: true, title: 'LyricsAdapter Settings',
        webPreferences: {
          preload: path.join(path.dirname(fileURLToPath(import.meta.url)), 'preload.cjs'),
          nodeIntegration: false, contextIsolation: true, webSecurity: true,
          spellcheck: false, sandbox: false,
        },
      });
      panel = child;
      openedPanel = child;
      child.on('closed', () => {
        win.removeListener('move', layout); win.removeListener('resize', layout);
        event.sender.removeListener('did-start-loading', ownerClosed);
        event.sender.removeListener('destroyed', ownerClosed);
        panel = null; parent = null; owner = null;
        resolveReady?.(); resolveReady = undefined;
        if (!event.sender.isDestroyed()) event.sender.send('settings-panel-closed');
        if (!win.isDestroyed() && !win.webContents.isDestroyed()) win.webContents.focus();
      });
      win.on('move', layout); win.on('resize', layout);
      event.sender.once('did-start-loading', ownerClosed); event.sender.once('destroyed', ownerClosed);
      layout();
      if (!native.attachSettingsGlass(child.getNativeWindowHandle())) { close(); return ok(false); }
      const ready = new Promise<void>(resolve => { resolveReady = resolve; });
      const timer = setTimeout(() => { if (!child.isDestroyed()) child.destroy(); }, 10000);
      try {
        child.webContents.setWindowOpenHandler(({ url }) => {
          if (url.startsWith('https://')) void shell.openExternal(url).catch(error => logger.warn('[SettingsPanel] Open link failed:', error));
          return { action: 'deny' };
        });
        child.webContents.on('will-navigate', e => e.preventDefault());
        await child.loadURL(`app://localhost/index.html?settings-panel=${section.data}`);
        await ready;
        return ok(!child.isDestroyed());
      } finally { clearTimeout(timer); }
    } catch (error) {
      logger.warn('[SettingsPanel] Using web settings:', error);
      if (openedPanel && !openedPanel.isDestroyed()) openedPanel.destroy();
      if (!panel) { parent = null; owner = null; }
      return ok(false);
    }
  });
  ipcMain.handle('ipc:settingsPanel:ready', (event, payload: unknown) => {
    const height = heightSchema.safeParse(payload);
    if (!height.success || !panel || event.sender !== panel.webContents || event.senderFrame !== event.sender.mainFrame) return fail('Invalid settings surface');
    contentHeight = Math.ceil(height.data); layout();
    if (!panel.isVisible()) { panel.show(); panel.webContents.focus(); }
    resolveReady?.(); resolveReady = undefined;
    return ok(undefined);
  });
  ipcMain.handle('ipc:settingsPanel:close', event => {
    if (event.senderFrame === event.sender.mainFrame && (event.sender === owner || event.sender === panel?.webContents)) close();
    return ok(undefined);
  });
  ipcMain.handle('ipc:settingsPanel:previewOpacity', (event, payload: unknown) => {
    if (event.sender !== panel?.webContents || event.senderFrame !== event.sender.mainFrame
      || typeof payload !== 'number' || !Number.isFinite(payload) || payload < 0 || payload > 1) return fail('Invalid settings preview');
    owner?.send('settings-panel-preview-opacity', payload);
    return ok(undefined);
  });
  ipcMain.handle('ipc:settingsPanel:shortcut', (event, payload: unknown) => {
    const shortcut = shortcutSchema.safeParse(payload);
    if (!shortcut.success || event.sender !== panel?.webContents || event.senderFrame !== event.sender.mainFrame) return fail('Invalid settings shortcut');
    owner?.send('settings-panel-shortcut', shortcut.data.key, shortcut.data.modifiers);
    return ok(undefined);
  });
}
