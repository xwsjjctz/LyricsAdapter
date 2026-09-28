// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { registerContextMenuHandlers } from '../../../electron/ipc/contextMenuHandlers';

const mocks = vi.hoisted(() => ({ handle: vi.fn(), fromWebContents: vi.fn(), buildFromTemplate: vi.fn(), popup: vi.fn() }));
vi.mock('electron', () => ({
  ipcMain: { handle: mocks.handle },
  BrowserWindow: { fromWebContents: mocks.fromWebContents },
  Menu: { buildFromTemplate: mocks.buildFromTemplate },
}));

const win = {};
const sender = { mainFrame: {} };
const event = { sender, senderFrame: sender.mainFrame };
const request = {
  x: 120.4, y: 80,
  items: [
    { kind: 'header', label: 'Download' },
    { kind: 'action', id: 'download:320', label: '320kbps' },
    { kind: 'separator' },
    { kind: 'action', id: 'remove', label: 'Remove' },
  ],
};
type Template = Array<{ type?: string; label?: string; click?: () => void }>;
function setup(platform: NodeJS.Platform = 'darwin') {
  registerContextMenuHandlers(platform);
  return (payload: unknown, source: unknown = event) =>
    mocks.handle.mock.calls.find(call => call[0] === 'ipc:contextMenu:popup')![1](source, payload);
}
const template = () => mocks.buildFromTemplate.mock.calls.at(-1)![0] as Template;
const popupOptions = () => mocks.popup.mock.calls.at(-1)![0] as { x: number; y: number; window: unknown; callback: () => void };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.fromWebContents.mockReturnValue(win);
  mocks.buildFromTemplate.mockReturnValue({ popup: mocks.popup });
});

describe('native context menu', () => {
  it('is macOS only and rejects foreign frames and malformed items', async () => {
    expect((await setup('win32')(request)).ok).toBe(false);
    const invoke = setup();
    expect((await invoke(request, { sender, senderFrame: {} })).ok).toBe(false);
    expect((await invoke({ ...request, items: [] })).ok).toBe(false);
    expect((await invoke({ ...request, items: [{ kind: 'action', id: 'x', label: '' }] })).ok).toBe(false);
    expect(mocks.popup).not.toHaveBeenCalled();
  });

  it('honours the native-glass opt-out so E2E keeps the web menu', async () => {
    const invoke = setup();
    vi.stubEnv('LYRICS_ADAPTER_DISABLE_NATIVE_GLASS', '1');
    try {
      expect((await invoke(request)).ok).toBe(false);
    } finally {
      vi.unstubAllEnvs();
    }
    expect(mocks.popup).not.toHaveBeenCalled();
  });

  it('builds a system menu with headers and resolves with the clicked id', async () => {
    const pending = setup()(request);
    expect(template().map(item => [item.type, item.label])).toEqual([
      ['header', 'Download'], [undefined, '320kbps'], ['separator', undefined], [undefined, 'Remove'],
    ]);
    expect(popupOptions()).toMatchObject({ window: win, x: 120, y: 80 });
    popupOptions().callback();
    template()[3]!.click!();
    await expect(pending).resolves.toEqual({ ok: true, data: 'remove' });
  });

  it('resolves null when the menu is dismissed', async () => {
    const pending = setup()(request);
    popupOptions().callback();
    await expect(pending).resolves.toEqual({ ok: true, data: null });
  });
});
