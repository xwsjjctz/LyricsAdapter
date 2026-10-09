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

/** How long the requested tab gets to render before a hidden panel is shown again. */
const SECTION_RENDER_MS = 40;

/**
 * A transparent settings renderer over the same AppKit material as Cmd+K. The
 * child window is created once, ahead of the first use, and then only shown and
 * hidden: building a window and loading the renderer on every open is what made
 * the sheet lag behind the shortcut.
 */
export function registerSettingsPanelHandlers(load = loadMacosSettingsGlassBridge, platform = process.platform): void {
  let panel: BrowserWindow | null = null;
  let parent: BrowserWindow | null = null;
  let owner: WebContents | null = null;
  let contentHeight = 600;
  /** Resolves once the child has mounted its controls; false if it never will. */
  let ready: Promise<boolean> | null = null;
  let mounted = false;
  let waiters: Array<(usable: boolean) => void> = [];
  /** The owner wants the sheet on screen; a prewarmed panel stays hidden. */
  let wanted = false;

  const layout = () => {
    if (!panel || !parent || panel.isDestroyed() || parent.isDestroyed()) return;
    // Same frame as the command palette (nativePalette.mm and palette.css):
    // 640 wide, 14% from the top, at most 560 tall or 72% of the window.
    const bounds = parent.getContentBounds();
    const width = Math.max(1, Math.min(640, bounds.width - 32));
    const maxHeight = Math.min(560, Math.floor(bounds.height * 0.72));
    const height = Math.max(1, Math.min(contentHeight, maxHeight));
    panel.setBounds({ x: bounds.x + Math.floor((bounds.width - width) / 2), y: bounds.y + Math.floor(bounds.height * 0.14), width, height });
  };
  const settle = (usable: boolean) => { const pending = waiters; waiters = []; for (const resolve of pending) resolve(usable); };
  const destroy = () => { if (panel && !panel.isDestroyed()) panel.destroy(); };
  const reveal = () => {
    if (!panel || panel.isDestroyed() || !mounted || !wanted) return;
    layout();
    if (!panel.isVisible()) { panel.show(); panel.webContents.focus(); }
  };
  /** Hides the sheet and keeps its renderer for the next open. */
  const conceal = () => {
    wanted = false;
    if (!panel || panel.isDestroyed() || !panel.isVisible()) return;
    panel.hide();
    if (owner && !owner.isDestroyed()) owner.send('settings-panel-closed');
    if (parent && !parent.isDestroyed() && !parent.webContents.isDestroyed()) parent.webContents.focus();
  };

  /** Builds the hidden child for `sender`; resolves false when native settings are unavailable. */
  const create = async (win: BrowserWindow, sender: WebContents, section: string): Promise<boolean> => {
    let child: BrowserWindow | null = null;
    try {
      const native = load();
      if (!native) return false;
      parent = win; owner = sender; contentHeight = 600; mounted = false;
      child = new BrowserWindow({
        // A panel can take the keyboard without becoming the main window, so the
        // player keeps its active title bar and the sheet reads as part of it.
        type: 'panel',
        parent: win, show: false, frame: false, transparent: true,
        resizable: false, minimizable: false, maximizable: false, fullscreenable: false,
        skipTaskbar: true, hasShadow: true, title: 'LyricsAdapter Settings',
        webPreferences: {
          preload: path.join(path.dirname(fileURLToPath(import.meta.url)), 'preload.cjs'),
          nodeIntegration: false, contextIsolation: true, webSecurity: true,
          spellcheck: false, sandbox: false,
        },
      });
      const opened = child;
      panel = opened;
      opened.on('closed', () => {
        const wasVisible = wanted && mounted;
        win.removeListener('move', layout); win.removeListener('resize', layout);
        sender.removeListener('did-start-loading', destroy);
        sender.removeListener('destroyed', destroy);
        panel = null; parent = null; owner = null; ready = null; mounted = false; wanted = false;
        settle(false);
        if (!sender.isDestroyed()) sender.send('settings-panel-closed');
        if (wasVisible && !win.isDestroyed() && !win.webContents.isDestroyed()) win.webContents.focus();
      });
      win.on('move', layout); win.on('resize', layout);
      // The panel belongs to one page load of the player; a reload starts over.
      sender.once('did-start-loading', destroy); sender.once('destroyed', destroy);
      layout();
      if (!native.attachSettingsGlass(opened.getNativeWindowHandle())) { destroy(); return false; }
      const timer = setTimeout(() => { if (!mounted && !opened.isDestroyed()) opened.destroy(); }, 10000);
      try {
        opened.webContents.setWindowOpenHandler(({ url }) => {
          if (url.startsWith('https://')) void shell.openExternal(url).catch(error => logger.warn('[SettingsPanel] Open link failed:', error));
          return { action: 'deny' };
        });
        opened.webContents.on('will-navigate', e => e.preventDefault());
        await opened.loadURL(`app://localhost/index.html?settings-panel=${section}`);
        if (opened.isDestroyed()) return false;
        const usable = mounted || await new Promise<boolean>(resolve => { waiters.push(resolve); });
        return usable && !opened.isDestroyed();
      } finally { clearTimeout(timer); }
    } catch (error) {
      logger.warn('[SettingsPanel] Using web settings:', error);
      if (child && !child.isDestroyed()) child.destroy();
      return false;
    }
  };
  const playerWindow = (event: Electron.IpcMainInvokeEvent) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    return win && !win.getParentWindow() && event.senderFrame === event.sender.mainFrame ? win : null;
  };
  const nativeDisabled = () => platform !== 'darwin' || process.env['LYRICS_ADAPTER_DISABLE_NATIVE_GLASS'] === '1';

  // Builds the hidden panel ahead of the first open, so that open only shows it.
  ipcMain.handle('ipc:settingsPanel:prewarm', event => {
    if (nativeDisabled()) return ok(false);
    const win = playerWindow(event);
    if (!win) return fail('Invalid settings request');
    if (panel) return ok(owner === event.sender);
    ready = create(win, event.sender, 'general');
    return ok(true);
  });
  ipcMain.handle('ipc:settingsPanel:open', async (event, payload: unknown) => {
    if (nativeDisabled()) return ok(false);
    const section = sectionSchema.safeParse(payload);
    const win = playerWindow(event);
    if (!section.success || !win) return fail('Invalid settings request');
    if (panel && owner !== event.sender) return fail('Settings panel already owned');
    wanted = true;
    const reused = !!panel && !!ready;
    if (!reused) ready = create(win, event.sender, section.data);
    if (!await ready) return ok(false);
    // Closed again while it was loading: stay hidden, but the surface is native.
    if (!panel || panel.isDestroyed() || !wanted) return ok(true);
    if (reused) {
      // A reused panel still shows wherever it was left; reset it to the
      // requested tab and let that render before a hidden panel appears.
      panel.webContents.send('settings-panel-section', section.data);
      if (!panel.isVisible()) await new Promise(resolve => setTimeout(resolve, SECTION_RENDER_MS));
      if (!panel || panel.isDestroyed() || !wanted) return ok(true);
    }
    reveal();
    return ok(true);
  });
  ipcMain.handle('ipc:settingsPanel:ready', (event, payload: unknown) => {
    const height = heightSchema.safeParse(payload);
    if (!height.success || !panel || event.sender !== panel.webContents || event.senderFrame !== event.sender.mainFrame) return fail('Invalid settings surface');
    contentHeight = Math.ceil(height.data); layout();
    mounted = true;
    settle(true);
    return ok(undefined);
  });
  ipcMain.handle('ipc:settingsPanel:close', event => {
    if (event.senderFrame === event.sender.mainFrame && (event.sender === owner || event.sender === panel?.webContents)) conceal();
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
