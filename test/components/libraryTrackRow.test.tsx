import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import LibraryTrackRow from '@/components/LibraryTrackRow';
import { themeManager } from '@/services/themeManager';

vi.mock('@/components/TrackCover', () => ({ default: () => <div data-testid="cover" /> }));
function setup(selecting = false, available = true) {
  const onTrackSelect = vi.fn();
  const onToggleSelect = vi.fn();
  const onOpenMenu = vi.fn();
  const rendered = render(<LibraryTrackRow
    track={{ id: 'track', title: 'A Song', artist: 'Artist', album: 'Album', duration: 60, audioUrl: '', available }}
    filteredIndex={8} realTrackIndex={12} isCurrentTrack={false} isSelecting={selecting}
    isSelected={false} isDragged={false} hasMenu canReorder={!selecting} shouldShowAnimation={false}
    colors={themeManager.getCurrentTheme().colors} onTrackSelect={onTrackSelect}
    onToggleSelect={onToggleSelect} onOpenMenu={onOpenMenu} onDragStart={vi.fn()}
    onDragOver={vi.fn()} onDrop={vi.fn()} onDragEnd={vi.fn()} />);
  return { ...rendered, onTrackSelect, onToggleSelect, onOpenMenu };
}
describe('song row interactions', () => {
  it('plays the original track index from a filtered list, without a number column', () => {
    const { container, onTrackSelect } = setup();
    fireEvent.click(screen.getByText('A Song'));
    expect(onTrackSelect).toHaveBeenCalledWith(12);
    expect(container.firstElementChild?.children).toHaveLength(3);
  });
  it('opens the right-click menu without playing or showing a more button', () => {
    const { container, onOpenMenu, onTrackSelect } = setup();
    fireEvent.contextMenu(container.firstElementChild!, { clientX: 40, clientY: 50 });
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(onOpenMenu).toHaveBeenCalledOnce();
    expect(onTrackSelect).not.toHaveBeenCalled();
  });
  it('lets unavailable songs be selected for removal and never plays during selection', () => {
    const { onToggleSelect, onTrackSelect } = setup(true, false);
    fireEvent.click(screen.getByText('A Song'));
    fireEvent.click(screen.getByRole('checkbox'));
    expect(onToggleSelect.mock.calls).toEqual([['track'], ['track']]);
    expect(onTrackSelect).not.toHaveBeenCalled();
    expect(screen.queryByTestId('cover')).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
  it('supports keyboard playback and a keyboard menu', () => {
    const { container, onTrackSelect, onOpenMenu } = setup();
    fireEvent.keyDown(container.firstElementChild!, { key: 'Enter' });
    fireEvent.keyDown(container.firstElementChild!, { key: 'F10', shiftKey: true });
    expect(onTrackSelect).toHaveBeenCalledOnce();
    expect(onOpenMenu).toHaveBeenCalledOnce();
  });
});
