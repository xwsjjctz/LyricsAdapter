import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import LibraryCollectionHeader from '@/components/LibraryCollectionHeader';
import i18n from '@/services/i18n';
import type { Track } from '@/types';

vi.mock('@/components/TrackCover', () => ({ default: ({ trackId }: { trackId: string }) => <div data-testid={`cover-${trackId}`} /> }));

const tracks = (count: number, duration = 200): Track[] => Array.from({ length: count }, (_, index) => ({
  id: `t${index}`, title: `Song ${index}`, artist: 'Artist', album: 'Album', duration, audioUrl: '',
}));

describe('library collection header', () => {
  it('shows a source as a mosaic of its first four covers with its count and length', () => {
    render(<LibraryCollectionHeader collection={{ title: 'Local', coverUrl: null, trackCount: 6 }} tracks={tracks(6, 600)} />);
    expect(screen.getByRole('heading', { name: 'Local' })).toBeInTheDocument();
    expect(screen.getAllByTestId(/^cover-/).map(node => node.dataset['testid'])).toEqual(['cover-t0', 'cover-t1', 'cover-t2', 'cover-t3']);
    expect(screen.getByText(`${i18n.t('library.playlistSongCount', { count: 6 })} · ${i18n.t('library.totalHours', { hours: 1, minutes: 0 })}`)).toBeInTheDocument();
  });

  it('uses a playlist\'s own artwork, and leaves out the length until every song has loaded', () => {
    const { container } = render(<LibraryCollectionHeader collection={{ title: 'Road Trip', coverUrl: 'https://cdn.example/cover.jpg', trackCount: 40 }} tracks={tracks(20)} />);
    expect(container.querySelector('img')).toHaveAttribute('src', 'https://cdn.example/cover.jpg');
    expect(screen.queryByTestId(/^cover-/)).toBeNull();
    expect(screen.getByText(i18n.t('library.playlistSongCount', { count: 40 }))).toBeInTheDocument();
  });

  it('falls back to the first cover with fewer than four songs, and never reads "0 minutes"', () => {
    render(<LibraryCollectionHeader collection={{ title: 'Cloud', coverUrl: null, trackCount: 2 }} tracks={tracks(2, 5)} />);
    expect(screen.getAllByTestId(/^cover-/).map(node => node.dataset['testid'])).toEqual(['cover-t0']);
    expect(screen.getByText(`${i18n.t('library.playlistSongCount', { count: 2 })} · ${i18n.t('library.totalMinutes', { count: 1 })}`)).toBeInTheDocument();
  });
});
