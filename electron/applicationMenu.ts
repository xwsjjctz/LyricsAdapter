import { app, Menu, type MenuItemConstructorOptions, type BrowserWindow } from 'electron';
import { DEFAULT_SHORTCUTS, resolveShortcutKey, type ShortcutAction } from '../src/constants/shortcuts';
import type { ApplicationMenuAction } from '../src/types/applicationMenu';
import zh from '../src/i18n/locales/zh.json';
import en from '../src/i18n/locales/en.json';
import ja from '../src/i18n/locales/ja.json';
import ko from '../src/i18n/locales/ko.json';
import de from '../src/i18n/locales/de.json';
import fr from '../src/i18n/locales/fr.json';
import { settingsStore } from './services/settingsStore';
import { applyWindowPreset, type WindowPreset } from './services/windowState';

const resources: Record<string, Record<string, string>> = { zh, en, ja, ko, de, fr };

function shortcutHint(action: ShortcutAction): string {
  let key = DEFAULT_SHORTCUTS[action].currentKey;
  try {
    const saved: unknown = JSON.parse(settingsStore.get('app-shortcuts') ?? '{}');
    if (saved && typeof saved === 'object' && action in saved) {
      key = resolveShortcutKey(action, (saved as Record<string, unknown>)[action]);
    }
  } catch { /* Corrupted settings use the same defaults as the renderer. */ }
  const symbols: Record<string, string> = {
    CmdOrCtrl: '⌘', Cmd: '⌘', Ctrl: '⌃', Alt: '⌥', Shift: '⇧',
    Backquote: '`', Enter: '↩', Space: '␣', Left: '←', Right: '→', Up: '↑', Down: '↓', Tab: '⇥',
  };
  return key.split('+').map(part => symbols[part] ?? part).join('');
}

/** Rebuild the entire menu when language or shortcut settings change. */
export function registerApplicationMenu(getWindow: () => BrowserWindow | null, platform = process.platform): void {
  if (platform !== 'darwin') return;
  const labels: Record<string, string> = resources[settingsStore.get('app-language') ?? 'zh'] ?? zh;
  const t = (key: string) => labels[key] ?? (zh as Record<string, string>)[key] ?? key;
  const role = (name: NonNullable<MenuItemConstructorOptions['role']>, key: string): MenuItemConstructorOptions => ({
    role: name, label: t(`menu.${key}`),
  });
  const separator: MenuItemConstructorOptions = { type: 'separator' };
  const action = (id: ApplicationMenuAction, key: string): MenuItemConstructorOptions => {
    const hint = id === 'showShortcuts' ? '' : shortcutHint(id);
    return {
      id: `menu-${id}`, label: `${t(key)}${hint ? `  (${hint})` : ''}`,
      // macOS registers native accelerators even with registerAccelerator:false.
      // Display a hint while leaving keydown/keyup with the renderer, especially
      // the held Ctrl/Cmd+` gesture and the user's configurable shortcuts.
      click: () => {
        const window = getWindow();
        if (window && !window.isDestroyed()) window.webContents.send('application-menu-action', id);
      },
    };
  };
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
        action('cyclePlaylists', 'shortcut.cyclePlaylists'), action('showShortcuts', 'settings.shortcuts.title'), separator,
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
