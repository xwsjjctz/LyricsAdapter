import type { TypedElectronIPC } from '../types/typedIpc';
import type { NativeContextMenuItem } from '../types/nativeContextMenu';
import type { TrackMenuItem } from '../components/trackMenuItems';
import { getDesktopAPI } from './desktopAdapter';

/** Darwin 25 is macOS 26, where NSMenu adopts Liquid Glass. */
const MIN_DARWIN_MAJOR = 25;

export type NativeContextMenuApi = NonNullable<TypedElectronIPC['contextMenu']>;

let unavailable = false;

/**
 * Records that the main process refused the system menu (unsupported, or opted
 * out for tests) so later menus open as web menus synchronously.
 */
export function markNativeContextMenuUnavailable(): void {
  unavailable = true;
}

/** The system menu bridge on macOS 26+, or undefined to keep the web menu. */
export function getNativeContextMenu(): NativeContextMenuApi | undefined {
  if (unavailable) return undefined;
  const desktop = getDesktopAPI();
  if (desktop?.platform !== 'darwin') return undefined;
  if (Number.parseInt(desktop.osRelease ?? '', 10) < MIN_DARWIN_MAJOR) return undefined;
  return desktop.ipc?.contextMenu;
}

/** Translates track menu items; group labels become native section headers. */
export function toNativeMenuItems(items: readonly TrackMenuItem[], t: (key: string) => string): NativeContextMenuItem[] {
  return items.map(item => {
    if (item.kind === 'separator') return { kind: 'separator' };
    if (item.kind === 'label') return { kind: 'header', label: t(item.labelKey) };
    return { kind: 'action', id: item.id, label: item.labelKey ? t(item.labelKey) : item.label ?? item.id };
  });
}
