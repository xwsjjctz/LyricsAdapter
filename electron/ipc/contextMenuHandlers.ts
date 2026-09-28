import { BrowserWindow, ipcMain, Menu, type MenuItemConstructorOptions } from 'electron';
import { z } from 'zod';
import type { NativeContextMenuItem } from '../../src/types/nativeContextMenu';
import { fail, ok, parsePayload } from './typedResult';

const label = z.string().min(1).max(256);
export const nativeContextMenuSchema = z.object({
  items: z.array(z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('action'), id: z.string().min(1).max(128), label }),
    z.object({ kind: z.literal('header'), label }),
    z.object({ kind: z.literal('separator') }),
  ])).min(1).max(64),
  x: z.number().finite().min(0).max(100_000),
  y: z.number().finite().min(0).max(100_000),
});

function toTemplate(items: readonly NativeContextMenuItem[], choose: (id: string) => void): MenuItemConstructorOptions[] {
  return items.map(item => {
    switch (item.kind) {
      case 'separator': return { type: 'separator' };
      case 'header': return { type: 'header', label: item.label };
      case 'action': return { label: item.label, click: () => choose(item.id) };
    }
  });
}

/**
 * Pops up a system (NSMenu) context menu and resolves with the chosen action
 * id, or null when dismissed. The renderer keeps deciding what each id does.
 */
export function registerContextMenuHandlers(platform = process.platform): void {
  ipcMain.handle('ipc:contextMenu:popup', async (event, payload: unknown) => {
    // Tests that drive the web menu opt out, like the other native surfaces.
    if (platform !== 'darwin' || process.env['LYRICS_ADAPTER_DISABLE_NATIVE_GLASS'] === '1') return fail('Unsupported platform');
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win || event.senderFrame !== event.sender.mainFrame) return fail('Invalid window');
    const request = parsePayload(nativeContextMenuSchema, payload);
    if (!request.ok) return request;
    return new Promise(resolve => {
      let settled = false;
      const settle = (id: string | null) => {
        if (settled) return;
        settled = true;
        resolve(ok(id));
      };
      const menu = Menu.buildFromTemplate(toTemplate(request.data.items, settle));
      menu.popup({
        window: win,
        x: Math.round(request.data.x),
        y: Math.round(request.data.y),
        // The close callback can run before the item's click; let a click win.
        callback: () => setTimeout(() => settle(null), 0),
      });
    });
  });
}
