// @vitest-environment node
import type { BrowserWindow, MenuItemConstructorOptions } from 'electron';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ settings: {} as Record<string, string>, build: vi.fn(), install: vi.fn(), preset: vi.fn() }));
vi.mock('electron', () => ({
  app: { name: 'LyricsAdapter', isPackaged: true },
  Menu: { buildFromTemplate: mocks.build, setApplicationMenu: mocks.install },
}));
vi.mock('../../electron/services/settingsStore', () => ({ settingsStore: { get: (key: string) => mocks.settings[key] } }));
vi.mock('../../electron/services/windowState', () => ({ applyWindowPreset: mocks.preset }));
import { registerApplicationMenu } from '../../electron/applicationMenu';

beforeEach(() => { mocks.settings = {}; vi.clearAllMocks(); });
function items(): MenuItemConstructorOptions[] {
  const template = mocks.build.mock.calls.at(-1)![0] as MenuItemConstructorOptions[];
  return template.flatMap(item => Array.isArray(item.submenu) ? item.submenu : []);
}

describe('localized macOS application menu', () => {
  it.each([
    ['zh', ['文件', '编辑', '视图', '窗口']], ['en', ['File', 'Edit', 'View', 'Window']],
    ['ja', ['ファイル', '編集', '表示', 'ウインドウ']], ['ko', ['파일', '편집', '보기', '윈도우']],
    ['de', ['Ablage', 'Bearbeiten', 'Darstellung', 'Fenster']], ['fr', ['Fichier', 'Édition', 'Présentation', 'Fenêtre']],
  ])('localizes the full menu in %s and preserves standard editing roles', (language, labels) => {
    mocks.settings['app-language'] = language;
    registerApplicationMenu(() => null, 'darwin');
    const template = mocks.build.mock.calls[0]![0] as MenuItemConstructorOptions[];
    expect(template.slice(1).map(item => item.label)).toEqual(labels);
    expect(items().filter(item => item.type !== 'separator').every(item => item.label && !item.label.startsWith('menu.'))).toBe(true);
    expect(items().map(item => item.role)).toEqual(expect.arrayContaining(['undo', 'redo', 'cut', 'copy', 'paste', 'selectAll', 'minimize']));
    // Application shortcuts remain renderer-owned: native accelerators must not swallow modifier release.
    expect(items().filter(item => item.id?.startsWith('menu-')).every(item => !item.accelerator)).toBe(true);
  });
  it('uses customized and cleared hints, with defaults for damaged settings', () => {
    mocks.settings['app-shortcuts'] = JSON.stringify({ toggleFocusMode: { currentKey: 'Ctrl+Shift+L' }, importMusic: { currentKey: '' } });
    registerApplicationMenu(() => null, 'darwin');
    expect(items().find(item => item.id === 'menu-toggleFocusMode')!.label).toContain('⌃⇧L');
    expect(items().find(item => item.id === 'menu-importMusic')!.label).toBe('导入音乐…');
    mocks.settings['app-shortcuts'] = 'broken'; mocks.settings['app-language'] = 'unsupported';
    registerApplicationMenu(() => null, 'darwin');
    expect(items().find(item => item.id === 'menu-importMusic')!.label).toContain('⌘I');
    mocks.settings['app-shortcuts'] = JSON.stringify({ importMusic: { defaultKey: 'CmdOrCtrl+O', currentKey: 'CmdOrCtrl+O' } });
    registerApplicationMenu(() => null, 'darwin');
    expect(items().find(item => item.id === 'menu-importMusic')!.label).toContain('⌘I');
  });
  it('routes menu clicks to the current live window, with presets owned by the main process', () => {
    const send = vi.fn(); let current: BrowserWindow | null = null;
    registerApplicationMenu(() => current, 'darwin');
    const choose = (id: string) => items().find(item => item.id === id)!.click!({} as never, null as never, {} as never);
    choose('menu-importMusic'); expect(send).not.toHaveBeenCalled();
    current = { isDestroyed: () => false, webContents: { send } } as unknown as BrowserWindow;
    choose('menu-importMusic'); expect(send).toHaveBeenCalledExactlyOnceWith('application-menu-action', 'importMusic');
    choose('window-preset-portrait'); expect(mocks.preset).toHaveBeenCalledExactlyOnceWith(current, 'portrait');
    current = { isDestroyed: () => true } as unknown as BrowserWindow;
    choose('menu-importMusic'); expect(send).toHaveBeenCalledOnce();
  });
  it('does not replace the menu on other platforms', () => {
    registerApplicationMenu(() => null, 'win32'); expect(mocks.install).not.toHaveBeenCalled();
  });
});
