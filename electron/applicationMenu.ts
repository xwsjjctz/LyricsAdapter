import { app, BrowserWindow, Menu, type MenuItemConstructorOptions } from 'electron';
import { DEFAULT_SHORTCUTS, resolveShortcutKey, type ShortcutAction } from '../src/constants/shortcuts';
import type { ApplicationMenuAction } from '../src/types/applicationMenu';
import { settingsStore } from './services/settingsStore';
import { mainTranslator } from './services/mainI18n';
import { applyWindowPreset, type WindowPreset } from './services/windowState';
import { sendIpc } from './ipc/ipcMainTyped';

function shortcutKey(action: ShortcutAction): string {
  try {
    const saved: unknown = JSON.parse(settingsStore.get('app-shortcuts') ?? '{}');
    if (saved && typeof saved === 'object' && action in saved) {
      return resolveShortcutKey(action, (saved as Record<string, unknown>)[action]);
    }
  } catch { /* Corrupted settings use the same defaults as the renderer. */ }
  return DEFAULT_SHORTCUTS[action].currentKey;
}

function shortcutHint(action: ShortcutAction): string {
  const key = shortcutKey(action);
  const symbols: Record<string, string> = {
    CmdOrCtrl: '⌘', Cmd: '⌘', Ctrl: '⌃', Alt: '⌥', Shift: '⇧',
    Backquote: '`', Enter: '↩', Space: '␣', Left: '←', Right: '→', Up: '↑', Down: '↓', Tab: '⇥',
  };
  return key.split('+').map(part => symbols[part] ?? part).join('');
}

const CYCLE_ON_COMMAND = new Set(['CmdOrCtrl+Backquote', 'Cmd+Backquote']);

/** Rebuild the entire menu when language or shortcut settings change. */
export function registerApplicationMenu(getWindow: () => BrowserWindow | null, platform = process.platform): void {
  if (platform !== 'darwin') return;
  const t = mainTranslator();
  const role = (name: NonNullable<MenuItemConstructorOptions['role']>, key: string): MenuItemConstructorOptions => ({
    role: name, label: t(`menu.${key}`),
  });
  const separator: MenuItemConstructorOptions = { type: 'separator' };
  const sendAction = (id: ApplicationMenuAction) => {
    const window = getWindow();
    if (window && !window.isDestroyed()) sendIpc(window.webContents, 'application-menu-action', id);
  };
  const action = (id: ApplicationMenuAction, key: string): MenuItemConstructorOptions => {
    const hint = id === 'showShortcuts' ? '' : shortcutHint(id);
    return {
      id: `menu-${id}`, label: `${t(key)}${hint ? `  (${hint})` : ''}`,
      // macOS registers native accelerators even with registerAccelerator:false.
      // Display a hint while leaving keydown/keyup with the renderer, especially
      // the held Ctrl+` gesture and the user's configurable shortcuts.
      click: () => sendAction(id),
    };
  };
  // macOS takes ⌘` for window cycling before any web contents sees it. Claim ⌘`
  // and ⇧⌘` as accelerators, then replay the chord into the focused window so the
  // held-⌘ gesture still runs through the renderer's keydown/keyup path.
  const cycleOnCommand = CYCLE_ON_COMMAND.has(shortcutKey('cyclePlaylists'));
  const replayCycle = (shift: boolean): NonNullable<MenuItemConstructorOptions['click']> => (_item, _window, event) => {
    const target = event.triggeredByAccelerator ? BrowserWindow.getFocusedWindow() : null;
    if (!target || target.isDestroyed()) { sendAction('cyclePlaylists'); return; }
    const modifiers: Array<'meta' | 'shift'> = shift ? ['meta', 'shift'] : ['meta'];
    target.webContents.sendInputEvent({ type: 'keyDown', keyCode: '`', modifiers });
    target.webContents.sendInputEvent({ type: 'keyUp', keyCode: '`', modifiers });
  };
  const cyclePlaylists: MenuItemConstructorOptions[] = cycleOnCommand
    ? [
      { id: 'menu-cyclePlaylists', label: t('shortcut.cyclePlaylists'), accelerator: 'Cmd+`', click: replayCycle(false) },
      { id: 'menu-cyclePlaylistsReverse', label: t('shortcut.cyclePlaylists'), accelerator: 'Cmd+Shift+`', visible: false, click: replayCycle(true) },
    ]
    : [action('cyclePlaylists', 'shortcut.cyclePlaylists')];
  const preset = (mode: WindowPreset): MenuItemConstructorOptions => ({
    id: `window-preset-${mode}`, label: t(`menu.${mode}`),
    click: () => { const window = getWindow(); if (window) applyWindowPreset(window, mode); },
  });
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {
      role: 'appMenu', label: app.name,
      submenu: [role('about', 'about'), separator, action('gotoSettings', 'menu.settings'), separator,
        role('hide', 'hide'), role('hideOthers', 'hideOthers'), role('unhide', 'showAll'), separator, role('quit', 'quit')],
    },
    { label: t('menu.file'), submenu: [action('importMusic', 'menu.importMusic'), separator, role('close', 'close')] },
    {
      role: 'editMenu', label: t('menu.edit'),
      submenu: [role('undo', 'undo'), role('redo', 'redo'), separator, role('cut', 'cut'), role('copy', 'copy'),
        role('paste', 'paste'), role('selectAll', 'selectAll'), separator, action('focusSearch', 'menu.searchMusic')],
    },
    {
      role: 'viewMenu', label: t('menu.view'),
      submenu: [action('toggleFocusMode', 'shortcut.toggleFocusMode'), action('toggleCommandPalette', 'shortcut.toggleCommandPalette'),
        ...cyclePlaylists, action('showShortcuts', 'settings.shortcuts.title'), separator,
        role('resetZoom', 'resetZoom'), role('zoomIn', 'zoomIn'), role('zoomOut', 'zoomOut'), separator,
        role('togglefullscreen', 'fullscreen'),
        ...(!app.isPackaged ? [separator, role('reload', 'reload'), role('toggleDevTools', 'devTools')] : [])],
    },
    {
      role: 'windowMenu', label: t('menu.window'),
      submenu: [preset('landscape'), preset('portrait'), separator, role('minimize', 'minimize'), role('zoom', 'zoom'),
        separator, role('front', 'front')],
    },
  ]));
}
