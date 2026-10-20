import { describe, expect, it, vi } from 'vitest';
import type { TFunction } from 'i18next';
import {
  cloudBlocks, configurationFieldId, configurationRows, generalBlocks, row, shortcutsBlocks, sourceLoginRows,
} from '@/components/settings/native/nativeSettingsModel';
import type { SourceLogin } from '@/components/settings/hooks/useSourceLogin';
import type { ConfigurationField } from '@/shared/plugin';
import type { ShortcutAction, ShortcutConfig } from '@/services/shortcuts';
import { NATIVE_SETTINGS_LIMITS, type NativeSettingsControl, type NativeSettingsRow } from '@/types/nativeSettings';

// Keys stand in for translations; interpolation values are kept so tests can see them.
const t = ((key: string, options?: Record<string, unknown>) => (options ? `${key} ${JSON.stringify(options)}` : key)) as unknown as TFunction;
const control = (rows: NativeSettingsRow[], id: string) => rows.flatMap(entry => entry.controls)
  .find(item => 'id' in item && item.id === id) as Extract<NativeSettingsControl, { id: string }> | undefined;

describe('native settings snapshot', () => {
  it('keeps rows within the limits the main process accepts', () => {
    const long = 'x'.repeat(NATIVE_SETTINGS_LIMITS.text + 10);
    const built = row('r', 'inline', {
      title: long, controls: Array.from({ length: NATIVE_SETTINGS_LIMITS.controls + 2 }, () => ({ type: 'spinner' as const })),
    });
    expect(built.title).toHaveLength(NATIVE_SETTINGS_LIMITS.text);
    expect(built.controls).toHaveLength(NATIVE_SETTINGS_LIMITS.controls);
    expect(built).toMatchObject({ detail: '', footnote: '', tone: 'default', detailTone: 'secondary' });
  });

  it('offers the installed-app update only when the build supports updates', () => {
    const general = (updater: Partial<{ visible: boolean; downloaded: boolean; busy: boolean }>) => generalBlocks({
      language: 'zh', languages: [{ value: 'zh', title: '中文' }], downloadPath: '/music', downloadRevision: 2, appVersion: '1.0.0',
      updater: { visible: false, status: 'updater.checking', error: '', downloaded: false, busy: false, ...updater },
    }, t)[0]!.rows;
    expect(general({}).map(entry => entry.id)).toEqual(['general:language', 'general:download', 'general:about']);
    expect(control(general({}), 'general:download-path')).toMatchObject({ type: 'field', value: '/music', revision: 2 });
    expect(control(general({ visible: true, busy: true }), 'general:check')).toMatchObject({ enabled: false });
    expect(control(general({ visible: true, downloaded: true }), 'general:restart')).toMatchObject({ style: 'primary' });
  });

  it('builds plugin configuration fields under their own id segment', () => {
    const fields: [string, ConfigurationField][] = [
      ['cache', { type: 'string', title: 'Cache dir', default: '' } as ConfigurationField],
      ['key', { type: 'string', format: 'secret', title: 'API key', default: '' } as ConfigurationField],
      ['model', { type: 'string', title: 'Model', default: 'a', enum: ['a', 'b'] } as ConfigurationField],
      ['stream', { type: 'boolean', title: 'Stream', default: false } as ConfigurationField],
    ];
    const prefix = 'plugin:llm:config';
    const rows = configurationRows(prefix, {
      fields, values: { cache: '/tmp' }, drafts: { cache: '/typed' }, secretDrafts: {}, revisions: { [configurationFieldId(prefix, 'key')]: 3 },
      configuredSecrets: [], busy: false, cacheEntries: 0, cacheBytes: 0, error: '',
    }, t);
    // A field named "cache" does not collide with the clear-cache button.
    expect(control(rows, configurationFieldId(prefix, 'cache'))).toMatchObject({ type: 'field', value: '/typed' });
    expect(control(rows, `${prefix}:cache`)).toMatchObject({ type: 'button', enabled: false });
    expect(control(rows, configurationFieldId(prefix, 'key'))).toMatchObject({ type: 'field', secure: true, value: '', revision: 3, placeholder: 'plugins.secretEmpty' });
    expect(control(rows, `${configurationFieldId(prefix, 'key')}:save`)).toMatchObject({ enabled: false });
    expect(control(rows, `${configurationFieldId(prefix, 'key')}:clear`)).toBeUndefined();
    expect(control(rows, configurationFieldId(prefix, 'model'))).toMatchObject({ type: 'popup', value: 'a', options: [{ value: 'a', title: 'a' }, { value: 'b', title: 'b' }] });
    expect(control(rows, configurationFieldId(prefix, 'stream'))).toMatchObject({ type: 'switch', on: false });

    const configured = configurationRows(prefix, {
      fields, values: {}, drafts: {}, secretDrafts: { key: 'sk-new' }, revisions: {},
      configuredSecrets: ['key'], busy: false, cacheEntries: 2, cacheBytes: 2048, error: 'Rejected',
    }, t);
    expect(control(configured, `${configurationFieldId(prefix, 'key')}:save`)).toMatchObject({ enabled: true });
    expect(control(configured, `${configurationFieldId(prefix, 'key')}:clear`)).toMatchObject({ type: 'button' });
    expect(configured.at(-1)).toMatchObject({ layout: 'message', tone: 'error', title: 'Rejected' });
  });

  it('shows the QR code until sign-in and keeps the cookie a saved credential', () => {
    const login = (overrides: Partial<SourceLogin>): SourceLogin => ({
      login: 'qq-qr', qrSupported: true, cookie: '', cookieDirty: false, signedIn: false, qrState: 'waiting',
      qrImage: 'data:image/png;base64,iVBORw0KGgo=', qrMsg: '', qrScanning: true, isSaving: false, message: null,
      setCookie: vi.fn(), saveCookie: vi.fn(), startQr: vi.fn(), logout: vi.fn(), ...overrides,
    });
    const waiting = sourceLoginRows('p', login({}), 0, t);
    expect(waiting.map(entry => entry.id)).toEqual(['p:qr', 'p:qr-image', 'p:cookie', 'p:cookie-save']);
    expect(control(waiting, 'p:cookie-save')).toMatchObject({ enabled: false });
    const signedIn = sourceLoginRows('p', login({ signedIn: true, qrScanning: false, qrImage: null, cookie: 'a=b', cookieDirty: true }), 4, t);
    expect(signedIn.map(entry => entry.id)).not.toContain('p:qr-image');
    expect(control(signedIn, 'p:logout')).toBeDefined();
    expect(control(signedIn, 'p:cookie')).toMatchObject({ value: 'a=b', revision: 4, lines: 3 });
    expect(signedIn.find(entry => entry.id === 'p:cookie-save')!.controls[0]).toMatchObject({ type: 'label', text: 'settingsDialog.unsaved' });
    const loading = sourceLoginRows('p', login({ qrState: 'loading', qrImage: null }), 0, t);
    expect(loading[0]!.controls).toEqual([{ type: 'spinner' }]);
  });

  it('marks customised bindings and offers Replace only for the key being recorded', () => {
    const config = (currentKey: string, defaultKey: string, name: string): ShortcutConfig =>
      ({ id: name, name, description: '', currentKey, defaultKey } as unknown as ShortcutConfig);
    const shortcuts = {
      playPause: config('Space', 'Space', 'shortcut.playPause'),
      toggleFocusMode: config('CmdOrCtrl+L', 'CmdOrCtrl+Enter', 'shortcut.toggleFocusMode'),
    } as Record<ShortcutAction, ShortcutConfig>;
    const blocks = shortcutsBlocks({
      shortcuts, list: Object.entries(shortcuts) as [ShortcutAction, ShortcutConfig][],
      editingAction: 'toggleFocusMode', conflict: { action: 'playPause', key: 'Space' }, displayKey: key => key,
    }, t);
    const rows = blocks[1]!.rows;
    expect(control(rows, 'shortcut:playPause')).toMatchObject({ type: 'shortcut', state: 'default', recording: false });
    expect(control(rows, 'shortcut:playPause:reset')).toBeUndefined();
    expect(control(rows, 'shortcut:toggleFocusMode')).toMatchObject({ state: 'custom', recording: true });
    expect(control(rows, 'shortcut:toggleFocusMode:reset')).toMatchObject({ symbol: 'arrow.counterclockwise' });
    expect(control(rows, 'shortcut:toggleFocusMode:replace')).toMatchObject({ style: 'primary' });
    expect(rows.find(entry => entry.id === 'shortcut:toggleFocusMode:conflict')).toMatchObject({ tone: 'accent' });
  });

  it('shows the WebDAV draft as unsaved and its test as running', () => {
    const rows = cloudBlocks({
      serverUrl: 'https://dav', username: 'me', password: 'secret', revision: 0,
      isDirty: true, isTesting: true, isSaving: false, message: null,
    }, t)[0]!.rows;
    expect(control(rows, 'cloud:password')).toMatchObject({ secure: true, value: 'secret' });
    expect(rows.find(entry => entry.id === 'cloud:save')!.controls.map(item => item.type)).toEqual(['label', 'spinner', 'button']);
    expect(control(rows, 'cloud:save')).toMatchObject({ title: 'settingsDialog.webdavTesting', enabled: false });
  });
});
