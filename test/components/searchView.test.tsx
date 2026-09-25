import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SearchView from '@/components/search/SearchView';
import i18n from '@/services/i18n';
import { settingsManager } from '@/services/settingsManager';
import type { Track } from '@/types';

function track(id: string, title: string): Track {
  return { id, title, artist: 'Artist', album: 'Album', duration: 125, audioUrl: '', source: 'local' };
}

const LOCAL = i18n.t('sidebar.local');

const localTracks = Array.from({ length: 7 }, (_, index) => track(`l${index}`, `Hello ${index}`));

function renderView(overrides: Partial<Parameters<typeof SearchView>[0]> = {}) {
  const props = {
    query: 'hello',
    localTracks,
    cloudTracks: [],
    searchBox: null,
    onNavigateToTrack: vi.fn(),
    onOnlineStreamPlay: vi.fn(),
    onDownloadTrack: vi.fn(),
    onlineProgress: {},
    ...overrides,
  };
  return { ...render(<SearchView {...props} />), props };
}

describe('SearchView', () => {
  beforeEach(() => {
    vi.spyOn(settingsManager, 'getQqMusicEnabled').mockReturnValue(false);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('previews each group on the All tab and links to the full group', () => {
    renderView();

    const localGroup = screen.getByRole('region', { name: LOCAL });
    expect(within(localGroup).getAllByText(/^Hello \d$/)).toHaveLength(5);

    fireEvent.click(within(localGroup).getByRole('button', { name: i18n.t('search.showAll', { count: 7 }) }));

    expect(screen.getByRole('tab', { name: new RegExp(LOCAL) })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getAllByText(/^Hello \d$/)).toHaveLength(7);
  });

  it('shows the match count on each tab', () => {
    renderView();
    expect(screen.getByRole('tab', { name: new RegExp(LOCAL) })).toHaveTextContent('7');
  });

  it('plays a library result through navigation', () => {
    const { props } = renderView();
    fireEvent.click(screen.getByText('Hello 2'));
    expect(props.onNavigateToTrack).toHaveBeenCalledWith(localTracks[2]);
  });

  it('explains when nothing matches', () => {
    renderView({ query: 'zzz-no-match' });
    expect(screen.getByText(i18n.t('search.noResults'))).toBeInTheDocument();
  });
});
