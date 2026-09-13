import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PlaybackIcon, usePlaybackSymbols } from '@/components/PlaybackIcon';

const mocks = vi.hoisted(() => ({ desktop: vi.fn() }));
vi.mock('@/services/desktopAdapter', () => ({ getDesktopAPI: mocks.desktop }));
function Icon({ name = 'play_arrow' }: { name?: 'play_arrow' | 'pause' }) {
  const symbols = usePlaybackSymbols();
  return <PlaybackIcon name={name} symbols={symbols} className="material-symbols-outlined text-2xl fill-icon" data-testid="icon" />;
}
describe('platform playback symbols', () => {
  it('preserves the Windows glyph and classes without requesting symbols', () => {
    const read = vi.fn();
    mocks.desktop.mockReturnValue({ platform: 'win32', ipc: { focusGlass: { getPlaybackSymbols: read } } });
    render(<Icon />);
    expect(screen.getByTestId('icon')).toHaveTextContent('play_arrow');
    expect(screen.getByTestId('icon')).toHaveClass('material-symbols-outlined', 'text-2xl', 'fill-icon');
    expect(screen.getByTestId('icon')).not.toHaveAttribute('style');
    expect(read).not.toHaveBeenCalled();
  });
  it('shares one palette and changes symbols without reloading it', async () => {
    const read = vi.fn().mockResolvedValue({ ok: true, data: { play_arrow: 'data:image/png;base64,play', pause: 'data:image/png;base64,pause' } });
    mocks.desktop.mockReturnValue({ platform: 'darwin', ipc: { focusGlass: { getPlaybackSymbols: read } } });
    const { rerender } = render(<><Icon /><Icon /></>);
    await waitFor(() => expect(screen.getAllByTestId('icon')[0]).toHaveAttribute('data-system-symbol', 'play_arrow'));
    expect(read).toHaveBeenCalledOnce();
    rerender(<Icon name="pause" />);
    await waitFor(() => expect(screen.getByTestId('icon')).toHaveAttribute('data-system-symbol', 'pause'));
    expect(screen.getByTestId('icon').style.maskImage).toContain('data:image/png;base64,pause');
    expect(read).toHaveBeenCalledOnce();
  });
  it('keeps fallback glyphs when the optional native API rejects', async () => {
    const read = vi.fn().mockRejectedValue(new Error('missing module'));
    mocks.desktop.mockReturnValue({ platform: 'darwin', ipc: { focusGlass: { getPlaybackSymbols: read } } });
    render(<Icon />);
    await waitFor(() => expect(read).toHaveBeenCalledOnce());
    expect(screen.getByTestId('icon')).toHaveTextContent('play_arrow');
  });
});
