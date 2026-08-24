import type { ComponentProps } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { OnlineSearchCard } from '@/components/search/SearchResultCards';
import { themeManager } from '@/services/themeManager';

const song = {
  songmid: 'song-1',
  songname: 'A deliberately longer song title',
  singer: [{ name: 'Singer' }],
  albumname: 'Album',
  coverUrl: 'https://example.com/cover.jpg',
};

const colors = themeManager.getCurrentTheme().colors;

function renderOnlineCard(overrides: Partial<ComponentProps<typeof OnlineSearchCard>> = {}) {
  const props: ComponentProps<typeof OnlineSearchCard> = {
    song,
    source: 'netease',
    isSelected: false,
    colors,
    isDownloadMenuOpen: false,
    isUploadMenuOpen: false,
    onToggleDownloadMenu: vi.fn(),
    onToggleUploadMenu: vi.fn(),
    onDownload: vi.fn(),
    onUpload: vi.fn(),
    onStreamPlay: vi.fn(),
    ...overrides,
  };
  return { ...render(<OnlineSearchCard {...props} />), props };
}

describe('OnlineSearchCard', () => {
  it('keeps playback on the card while action buttons stop propagation', () => {
    const { container, props } = renderOnlineCard();
    fireEvent.click(screen.getByText(song.songname));
    expect(props.onStreamPlay).toHaveBeenCalledTimes(1);

    const downloadButton = container.querySelector('.search-result-card__action-wrap button');
    expect(downloadButton).not.toBeNull();
    fireEvent.click(downloadButton!);
    expect(props.onToggleDownloadMenu).toHaveBeenCalledTimes(1);
    expect(props.onStreamPlay).toHaveBeenCalledTimes(1);
  });

  it('preserves quality selection and progress presentation', () => {
    const onDownload = vi.fn();
    const { container: menuContainer } = renderOnlineCard({ isDownloadMenuOpen: true, onDownload });
    expect(menuContainer.querySelector('.search-quality-menu')).toHaveStyle({ backgroundColor: colors.backgroundDark });
    fireEvent.click(screen.getByRole('button', { name: 'FLAC' }));
    expect(onDownload).toHaveBeenCalledWith('flac');

    const { container } = renderOnlineCard({ progress: { type: 'download', percent: 64 } });
    expect(container.querySelector('.search-result-card__progress span')).toHaveStyle({ width: '64%' });
  });
});
