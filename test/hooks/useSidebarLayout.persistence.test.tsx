import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getItem: vi.fn(),
  setItem: vi.fn(),
  getSetting: vi.fn(),
  setSetting: vi.fn(),
  deleteSetting: vi.fn(),
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('@/services/appStorage', () => ({
  appStorage: {
    getItem: mocks.getItem,
    setItem: mocks.setItem,
  },
}));

vi.mock('@/services/indexedDBStorage', () => ({
  indexedDBStorage: {
    getSetting: mocks.getSetting,
    setSetting: mocks.setSetting,
    deleteSetting: mocks.deleteSetting,
  },
}));

vi.mock('@/services/logger', () => ({ logger: mocks.logger }));

import {
  SIDEBAR_DEFAULT_WIDTH,
  useSidebarLayout,
} from '@/hooks/useSidebarLayout';

describe('useSidebarLayout persistence', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getItem.mockReturnValue(null);
    mocks.setItem.mockResolvedValue(undefined);
    mocks.getSetting.mockResolvedValue(null);
    mocks.setSetting.mockResolvedValue(undefined);
    mocks.deleteSetting.mockResolvedValue(undefined);
  });

  it('uses AppStorage as the authority and cleans the retired IDB value', async () => {
    mocks.getItem.mockReturnValue('{"width":224,"collapsed":true}');

    const { result } = renderHook(() => useSidebarLayout());

    expect(result.current.width).toBe(224);
    expect(result.current.collapsed).toBe(true);
    expect(mocks.getSetting).not.toHaveBeenCalled();
    await waitFor(() => expect(mocks.deleteSetting).toHaveBeenCalledWith('sidebar-layout'));
  });

  it('repairs an invalid AppStorage layout from valid legacy IDB before cleanup', async () => {
    const legacy = '{"width":216,"collapsed":true}';
    mocks.getItem.mockReturnValue('{"width":"wide","collapsed":false}');
    mocks.getSetting.mockResolvedValue(legacy);

    const { result } = renderHook(() => useSidebarLayout());

    await waitFor(() => {
      expect(result.current.width).toBe(216);
      expect(result.current.collapsed).toBe(true);
    });
    await waitFor(() => expect(mocks.deleteSetting).toHaveBeenCalledWith('sidebar-layout'));
    expect(mocks.setItem).toHaveBeenCalledWith('sidebar-layout', legacy);
    expect(mocks.setItem.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.deleteSetting.mock.invocationCallOrder[0],
    );
  });

  it.each([
    ['array target', '[]'],
    ['invalid collapsed type', '{"width":208,"collapsed":"yes"}'],
  ])('does not delete IDB when both the %s and legacy value are invalid', async (_name, stored) => {
    mocks.getItem.mockReturnValue(stored);
    mocks.getSetting.mockResolvedValue('{"width":null,"collapsed":false}');

    const { result } = renderHook(() => useSidebarLayout());

    await waitFor(() => expect(mocks.getSetting).toHaveBeenCalledWith('sidebar-layout'));
    expect(result.current.width).toBe(SIDEBAR_DEFAULT_WIDTH);
    expect(result.current.collapsed).toBe(false);
    expect(mocks.setItem).not.toHaveBeenCalled();
    expect(mocks.deleteSetting).not.toHaveBeenCalled();
  });

  it('migrates the legacy IDB layout only after AppStorage accepts it', async () => {
    const legacy = '{"width":220,"collapsed":true}';
    mocks.getSetting.mockResolvedValue(legacy);

    const { result } = renderHook(() => useSidebarLayout());

    await waitFor(() => {
      expect(result.current.width).toBe(220);
      expect(result.current.collapsed).toBe(true);
    });
    await waitFor(() => expect(mocks.deleteSetting).toHaveBeenCalledWith('sidebar-layout'));
    expect(mocks.setItem).toHaveBeenCalledWith('sidebar-layout', legacy);
    expect(mocks.setItem.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.deleteSetting.mock.invocationCallOrder[0],
    );
    expect(mocks.setSetting).not.toHaveBeenCalled();
  });

  it('keeps the legacy IDB source when migration persistence fails', async () => {
    const legacy = '{"width":192,"collapsed":true}';
    mocks.getSetting.mockResolvedValue(legacy);
    mocks.setItem.mockRejectedValue(new Error('settings unavailable'));

    const { result } = renderHook(() => useSidebarLayout());

    await waitFor(() => expect(result.current.collapsed).toBe(true));
    await waitFor(() => expect(mocks.logger.warn).toHaveBeenCalled());
    expect(mocks.deleteSetting).not.toHaveBeenCalled();
  });

  it('persists user changes through AppStorage without writing IDB', async () => {
    const { result } = renderHook(() => useSidebarLayout());
    await waitFor(() => expect(mocks.getSetting).toHaveBeenCalledWith('sidebar-layout'));
    mocks.setItem.mockClear();

    act(() => result.current.toggleCollapsed());

    expect(result.current.collapsed).toBe(true);
    expect(mocks.setItem).toHaveBeenCalledWith(
      'sidebar-layout',
      JSON.stringify({ width: SIDEBAR_DEFAULT_WIDTH, collapsed: true }),
    );
    expect(mocks.setSetting).not.toHaveBeenCalled();
  });
});
