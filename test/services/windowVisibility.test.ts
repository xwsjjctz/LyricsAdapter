import { afterEach, describe, expect, it, vi } from 'vitest';

const bridge = vi.hoisted(() => ({
  onWindowVisibilityChange: vi.fn<(callback: (visible: boolean) => void) => () => void>(() => () => {}),
}));

vi.mock('@/services/desktopAdapter', () => ({
  getDesktopAPI: () => bridge,
}));

import { isWindowVisible, subscribeWindowVisibility } from '@/services/windowVisibility';

describe('window visibility', () => {
  afterEach(() => {
    document.documentElement.removeAttribute('data-window-hidden');
  });

  it('follows the main process and marks the root while hidden', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeWindowVisibility(listener);
    subscribeWindowVisibility(() => {})();
    expect(bridge.onWindowVisibilityChange).toHaveBeenCalledOnce();
    const report = bridge.onWindowVisibilityChange.mock.calls[0]![0];

    expect(isWindowVisible()).toBe(true);
    report(false);
    expect(isWindowVisible()).toBe(false);
    expect(document.documentElement.hasAttribute('data-window-hidden')).toBe(true);
    report(false);
    expect(listener).toHaveBeenCalledOnce();

    report(true);
    expect(isWindowVisible()).toBe(true);
    expect(document.documentElement.hasAttribute('data-window-hidden')).toBe(false);
    expect(listener).toHaveBeenCalledTimes(2);

    unsubscribe();
    report(false);
    expect(listener).toHaveBeenCalledTimes(2);
    report(true);
  });
});
