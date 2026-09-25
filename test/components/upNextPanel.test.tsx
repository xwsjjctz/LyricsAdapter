import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import UpNextPanel from '@/components/UpNextPanel';
import i18n from '@/services/i18n';
import type { Track } from '@/types';

const tracks: Track[] = ['One', 'Two', 'Three'].map(title => ({
  id: title, title, artist: 'Artist', album: 'Album', duration: 61, audioUrl: '',
}));

function renderPanel(overrides: Partial<Parameters<typeof UpNextPanel>[0]> = {}) {
  const props = {
    tracks,
    currentIndex: 0,
    mode: 'order' as const,
    sourceLabel: 'Local',
    onPlayIndex: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  };
  return { ...render(<UpNextPanel {...props} />), props };
}

describe('UpNextPanel', () => {
  it('shows the current track and where it plays from', () => {
    renderPanel();
    expect(screen.getByRole('complementary', { name: i18n.t('upNext.title') })).toBeInTheDocument();
    expect(screen.getByText('One')).toBeInTheDocument();
    expect(screen.getByText(i18n.t('upNext.playingFrom', { source: 'Local' }))).toBeInTheDocument();
  });

  it('plays an upcoming track by its list index', () => {
    const { props } = renderPanel();
    fireEvent.click(screen.getByRole('button', { name: /Three/ }));
    expect(props.onPlayIndex).toHaveBeenCalledWith(2);
  });

  it('explains shuffle instead of guessing the order', () => {
    renderPanel({ mode: 'shuffle' });
    expect(screen.getByText(i18n.t('upNext.shuffleNote'))).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Two/ })).not.toBeInTheDocument();
  });

  it('closes on Escape', () => {
    const { props } = renderPanel();
    fireEvent.keyDown(screen.getByRole('complementary'), { key: 'Escape' });
    expect(props.onClose).toHaveBeenCalled();
  });

  it('says when nothing is playing', () => {
    renderPanel({ currentIndex: -1 });
    expect(screen.getByText(i18n.t('upNext.nothingPlaying'))).toBeInTheDocument();
  });
});
