import { BrowserWindow, type WebContents } from 'electron';
import { z } from 'zod';
import {
  loadMacosNativeSettingsBridge,
  type MacosNativeSettingsBridge,
} from '../native/macosFocusGlassNative';
import { logger } from '../logger';
import { NATIVE_SETTINGS_LIMITS } from '../../src/types/nativeSettings';
import { fail, ok, parsePayload } from './typedResult';
import { handleIpc, sendIpc } from './ipcMainTyped';

const text = z.string().max(NATIVE_SETTINGS_LIMITS.text);
const id = z.string().min(1).max(256);
const symbol = z.string().max(128);
const tone = z.enum(['default', 'secondary', 'muted', 'accent', 'success', 'error']);
const control = z.discriminatedUnion('type', [
  z.object({ type: z.literal('label'), text, tone }),
  z.object({
    type: z.literal('button'), id, title: text, symbol,
    style: z.enum(['primary', 'secondary', 'plain', 'destructive']), enabled: z.boolean(), label: text,
  }),
  z.object({ type: z.literal('link'), id, title: text, url: z.string().max(2048).regex(/^https:\/\/[^\s]+$/) }),
  z.object({ type: z.literal('disclosure'), id, title: text, expanded: z.boolean(), label: text }),
  z.object({ type: z.literal('switch'), id, on: z.boolean(), enabled: z.boolean(), label: text }),
  z.object({
    type: z.literal('popup'), id, value: text, enabled: z.boolean(), label: text,
    options: z.array(z.object({ value: text, title: text })).max(NATIVE_SETTINGS_LIMITS.options),
  }),
  z.object({
    type: z.literal('slider'), id, value: z.number().finite(), min: z.number().finite(), max: z.number().finite(),
    step: z.number().finite().positive(), display: text, label: text,
  }).refine(slider => slider.min < slider.max, { message: 'Slider range is empty' }),
  z.object({
    type: z.literal('field'), id, value: z.string().max(NATIVE_SETTINGS_LIMITS.field), revision: z.number().int().min(0),
    placeholder: text, secure: z.boolean(), lines: z.number().int().min(1).max(8), enabled: z.boolean(), label: text,
  }),
  z.object({
    type: z.literal('shortcut'), id, display: text, state: z.enum(['default', 'custom', 'unset']),
    recording: z.boolean(), prompt: text, label: text,
  }),
  z.object({
    type: z.literal('image'), id, size: z.number().int().min(16).max(512), label: text,
    source: z.string().max(NATIVE_SETTINGS_LIMITS.image).regex(/^data:image\/png;base64,[A-Za-z0-9+/=]+$/),
  }),
  z.object({ type: z.literal('spinner') }),
]);
const controls = z.array(control).max(NATIVE_SETTINGS_LIMITS.controls);
const row = z.object({
  id,
  layout: z.enum(['inline', 'stacked', 'message', 'note', 'subheading', 'center', 'actions']),
  title: text, detail: text, footnote: text, tone, detailTone: tone, controls,
});
const block = z.object({
  id, kind: z.enum(['card', 'plain']), heading: text, headingControls: controls,
  rows: z.array(row).max(NATIVE_SETTINGS_LIMITS.rows),
});
const sectionId = z.enum(['general', 'plugins', 'cloud', 'focus', 'shortcuts']);
export const nativeSettingsStateSchema = z.object({
  open: z.boolean(),
  darkMode: z.boolean(),
  title: text,
  closeLabel: text,
  unsavedLabel: text,
  reveal: z.object({ section: sectionId, token: z.number().int().min(0) }),
  sections: z.array(z.object({
    id: sectionId, title: text, navTitle: text, symbol: symbol.min(1), unsaved: z.boolean(),
    blocks: z.array(block).max(NATIVE_SETTINGS_LIMITS.blocks),
  })).min(1).max(NATIVE_SETTINGS_LIMITS.sections),
  dialog: z.object({
    title: text, message: text, error: text, confirmTitle: text, cancelTitle: text,
    destructive: z.boolean(), busy: z.boolean(),
  }).nullable(),
});

/** Owns the native macOS settings sheet of one player page while its state stays in React. */
export function registerNativeSettingsHandlers(load = loadMacosNativeSettingsBridge, platform = process.platform): void {
  let bridge: MacosNativeSettingsBridge | null = null;
  let owner: WebContents | null = null;

  const release = () => {
    owner?.removeListener('did-start-loading', destroy);
    owner?.removeListener('destroyed', destroy);
    owner = null;
  };
  // Closing settings keeps the sheet's views for the next open; a reload starts over.
  const stop = () => { release(); bridge?.stopNativeSettings(); };
  function destroy() { release(); bridge?.destroyNativeSettings(); }

  handleIpc('ipc:nativeSettings:start', event => {
    if (platform !== 'darwin' || process.env['LYRICS_ADAPTER_DISABLE_NATIVE_GLASS'] === '1') return ok(false);
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win || event.senderFrame !== event.sender.mainFrame) return fail('Invalid window');
    if (owner && owner !== event.sender) return fail('Surface already owned');
    try {
      bridge ??= load();
      if (!bridge) return ok(false);
      release();
      const sender = event.sender;
      const started = bridge.startNativeSettings(win.getNativeWindowHandle(), action => {
        if (owner === sender && !sender.isDestroyed()) sendIpc(sender, 'native-settings-action', action);
      });
      if (started) {
        owner = sender;
        // The sheet belongs to one page load of the player; a reload starts over.
        sender.once('did-start-loading', destroy);
        sender.once('destroyed', destroy);
      }
      return ok(started);
    } catch (error) {
      destroy();
      logger.warn('[NativeSettings] Native surface unavailable; using web settings:', error);
      return ok(false);
    }
  });

  handleIpc('ipc:nativeSettings:update', (event, payload: unknown) => {
    if (owner !== event.sender || event.senderFrame !== event.sender.mainFrame) return fail('Inactive surface');
    const state = parsePayload(nativeSettingsStateSchema, payload);
    if (!state.ok) return state;
    try {
      bridge!.updateNativeSettings(state.data);
      return ok(undefined);
    } catch (error) {
      destroy();
      logger.warn('[NativeSettings] Update failed:', error);
      return fail('Native settings unavailable');
    }
  });

  handleIpc('ipc:nativeSettings:stop', event => {
    if (owner === event.sender && event.senderFrame === event.sender.mainFrame) stop();
    return ok(undefined);
  });
}
