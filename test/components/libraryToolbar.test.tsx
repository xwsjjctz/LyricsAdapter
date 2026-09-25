import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import LibraryToolbar from '@/components/LibraryToolbar';
import i18n from '@/services/i18n';
import { themeManager } from '@/services/themeManager';
import type { SlotId } from '@/types';

const colors = themeManager.getCurrentTheme().colors;

function renderToolbar(dataSource: SlotId) {
  return render(
    <LibraryToolbar
      dataSource={dataSource}
      colors={colors}
      onImportClick={vi.fn()}
      onRefreshCloud={vi.fn()}
      trackCount={0}
      searchBox={<div className="global-search-box" />}
    />,
  );
}

describe('LibraryToolbar fixed-size actions', () => {
  it('offers a single labelled add-music action beside local search', () => {
    const { container, getByRole } = renderToolbar('local');
    const buttons = container.querySelectorAll('.library-toolbar-actions button');

    expect(buttons).toHaveLength(1);
    expect(getByRole('button', { name: new RegExp(i18n.t('library.addMusic')) })).toBeEnabled();
  });

  it('keeps cloud refresh fixed-size while audio upload is unavailable', () => {
    const { container } = renderToolbar('cloud');
    const actionButtons = container.querySelectorAll('.library-toolbar-actions > button');

    expect(actionButtons).toHaveLength(1);
    expect(actionButtons[0]).toHaveTextContent('refresh');
    actionButtons.forEach(button => expect(button).toHaveClass('w-10', 'h-10', 'shrink-0'));
  });
});

describe('LibraryToolbar playlist header', () => {
  it('offers play all and shuffle for a loaded playlist', () => {
    const onPlayAll = vi.fn();
    const onShuffleAll = vi.fn();
    const { getByRole } = render(
      <LibraryToolbar dataSource="playlist" colors={colors} trackCount={3} playlistTitle="Mix"
        playlistTrackCount={651} onPlayAll={onPlayAll} onShuffleAll={onShuffleAll} />,
    );

    fireEvent.click(getByRole('button', { name: new RegExp(i18n.t('library.playAll')) }));
    fireEvent.click(getByRole('button', { name: new RegExp(i18n.t('library.shuffleAll')) }));

    expect(onPlayAll).toHaveBeenCalledOnce();
    expect(onShuffleAll).toHaveBeenCalledOnce();
  });

  it('disables playlist actions until songs are loaded', () => {
    const { getByRole } = render(
      <LibraryToolbar dataSource="playlist" colors={colors} trackCount={0} playlistTitle="Mix"
        onPlayAll={vi.fn()} onShuffleAll={vi.fn()} />,
    );
    expect(getByRole('button', { name: new RegExp(i18n.t('library.playAll')) })).toBeDisabled();
  });

  it('describes a playlist by song count rather than as the collection', () => {
    const { getByText } = render(
      <LibraryToolbar dataSource="playlist" colors={colors} trackCount={3} playlistTitle="Mix" playlistTrackCount={651} />,
    );
    expect(getByText(i18n.t('library.playlistSongCount', { count: 651 }))).toBeInTheDocument();
  });
});
