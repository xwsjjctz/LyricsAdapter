import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import TrackMenu from '@/components/TrackMenu';
import { buildTrackMenuItems } from '@/components/trackMenuItems';
import type { ThemeColors } from '@/types/theme';

const mocks = vi.hoisted(() => ({ popup: vi.fn() }));
vi.mock('@/services/desktopAdapter', async importOriginal => ({
  ...await importOriginal<typeof import('@/services/desktopAdapter')>(),
  getDesktopAPI: () => ({ platform: 'darwin', osRelease: '27.0.0', ipc: { contextMenu: { popup: mocks.popup } } }),
}));

const colors = {} as ThemeColors;
function renderMenu() {
  const onClose = vi.fn();
  const onAction = vi.fn();
  const position = { trackId: 't1', x: 40, y: 60, trigger: document.body };
  const items = buildTrackMenuItems({ dataSource: 'local', canEdit: true, canDownload: false });
  const view = render(<TrackMenu position={position} colors={colors} items={items} onClose={onClose} onAction={onAction} />);
  return { onClose, onAction, view };
}

describe('TrackMenu on macOS 26+', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('pops up the system menu at the pointer and runs the chosen action', async () => {
    mocks.popup.mockResolvedValue({ ok: true, data: 'remove' });
    const { onClose, onAction, view } = renderMenu();
    expect(view.container).toBeEmptyDOMElement();
    expect(screen.queryByRole('menu')).toBeNull();
    await waitFor(() => expect(onAction).toHaveBeenCalledWith('remove'));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(mocks.popup).toHaveBeenCalledWith(expect.objectContaining({ x: 40, y: 60 }));
    expect(mocks.popup.mock.calls[0]![0].items.at(-1)).toEqual({ kind: 'action', id: 'remove', label: 'library.remove' });
  });

  it('closes without an action when dismissed or given an unknown id', async () => {
    mocks.popup.mockResolvedValue({ ok: true, data: 'not-an-item' });
    const { onClose, onAction } = renderMenu();
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(onAction).not.toHaveBeenCalled();
  });

  it('falls back to the web menu when the system menu is unavailable', async () => {
    mocks.popup.mockResolvedValue({ ok: false, error: 'Unsupported platform' });
    renderMenu();
    expect(await screen.findByRole('menu')).toBeInTheDocument();
  });
});
