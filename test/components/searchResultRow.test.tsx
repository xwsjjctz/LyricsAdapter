import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import SearchResultRow from '@/components/search/SearchResultRow';
import { onlineSongToTrack } from '@/domain/trackFactory';
import { themeManager } from '@/services/themeManager';

const colors = themeManager.getCurrentTheme().colors;
const track = onlineSongToTrack(
  { songmid: 'song-1', songname: 'Song title', singer: [{ name: 'Singer' }], albumname: 'Album' },
  'netease',
);

describe('SearchResultRow', () => {
  it('activates on click and keyboard', () => {
    const onActivate = vi.fn();
    render(<SearchResultRow track={track} isSelected={false} colors={colors} onActivate={onActivate} />);
    const row = screen.getByRole('option', { name: /Song title/ });

    fireEvent.click(row);
    fireEvent.keyDown(row, { key: 'Enter' });

    expect(onActivate).toHaveBeenCalledTimes(2);
  });

  it('ignores Enter with modifiers so app shortcuts do not activate the row', () => {
    const onActivate = vi.fn();
    render(<SearchResultRow track={track} isSelected={false} colors={colors} onActivate={onActivate} />);
    fireEvent.keyDown(screen.getByRole('option', { name: /Song title/ }), { key: 'Enter', metaKey: true });
    expect(onActivate).not.toHaveBeenCalled();
  });

  it('shows the provider badge for online tracks', () => {
    render(<SearchResultRow track={track} isSelected={false} colors={colors} onActivate={vi.fn()} />);
    expect(screen.getByText('search.sourceNetease')).toBeInTheDocument();
  });

  it('opens the song menu from a right click without activating', () => {
    const onActivate = vi.fn();
    const onOpenMenu = vi.fn();
    render(<SearchResultRow track={track} isSelected={false} colors={colors} onActivate={onActivate} onOpenMenu={onOpenMenu} />);

    fireEvent.contextMenu(screen.getByRole('option'), { clientX: 10, clientY: 20 });

    expect(onOpenMenu).toHaveBeenCalledWith(track, 10, 20, expect.any(HTMLElement));
    expect(onActivate).not.toHaveBeenCalled();
  });

  it('replaces the duration with download progress while downloading', () => {
    render(<SearchResultRow track={{ ...track, duration: 200 }} isSelected={false} colors={colors} onActivate={vi.fn()} progress={42} />);
    expect(screen.getByText('42%')).toBeInTheDocument();
    expect(screen.queryByText('3:20')).not.toBeInTheDocument();
  });
});
