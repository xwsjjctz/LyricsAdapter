import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getNativeContextMenu, toNativeMenuItems } from '@/services/nativeContextMenu';
import { buildTrackMenuItems } from '@/components/trackMenuItems';

const desktop = vi.hoisted(() => ({ value: undefined as unknown }));
vi.mock('@/services/desktopAdapter', () => ({ getDesktopAPI: () => desktop.value }));

const contextMenu = { popup: vi.fn() };
beforeEach(() => { desktop.value = undefined; });

describe('native context menu gate', () => {
  it('uses the system menu only on macOS 26 (Darwin 25) and later', () => {
    desktop.value = { platform: 'darwin', osRelease: '27.0.0', ipc: { contextMenu } };
    expect(getNativeContextMenu()).toBe(contextMenu);
    desktop.value = { platform: 'darwin', osRelease: '25.1.0', ipc: { contextMenu } };
    expect(getNativeContextMenu()).toBe(contextMenu);
    desktop.value = { platform: 'darwin', osRelease: '24.6.0', ipc: { contextMenu } };
    expect(getNativeContextMenu()).toBeUndefined();
    desktop.value = { platform: 'win32', osRelease: '27.0.0', ipc: { contextMenu } };
    expect(getNativeContextMenu()).toBeUndefined();
    desktop.value = { platform: 'darwin', osRelease: '27.0.0', ipc: {} };
    expect(getNativeContextMenu()).toBeUndefined();
  });

  it('translates labels and turns group labels into section headers', () => {
    const items = buildTrackMenuItems({ dataSource: 'online', canEdit: true, canDownload: true });
    expect(toNativeMenuItems(items, key => `t:${key}`)).toEqual([
      { kind: 'header', label: 't:browse.download' },
      { kind: 'action', id: 'download:128', label: '128kbps' },
      { kind: 'action', id: 'download:320', label: '320kbps' },
      { kind: 'action', id: 'download:flac', label: 'FLAC' },
      { kind: 'separator' },
      { kind: 'action', id: 'select', label: 't:library.selectMultiple' },
      { kind: 'separator' },
      { kind: 'action', id: 'remove', label: 't:library.remove' },
    ]);
  });
});
