import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Track } from '@/types';

const rendererMocks = vi.hoisted(() => ({
  legacyUnmounted: vi.fn(),
  amllUnmounted: vi.fn(),
}));

vi.mock('@/components/focus-mode/FocusLegacyLyrics', async () => {
  const React = await import('react');
  return {
    default: function MockLegacyLyrics(props: { fontSize: number; lineSpacing: number }) {
      React.useEffect(() => () => rendererMocks.legacyUnmounted(), []);
      return React.createElement('div', {
        'data-testid': 'mock-legacy-renderer',
        'data-font-size': props.fontSize,
        'data-line-spacing': props.lineSpacing,
      });
    },
  };
});

vi.mock('@/components/focus-mode/FocusAmlLyrics', async () => {
  const React = await import('react');
  return {
    default: function MockAmlLyrics(props: { fontSize: number; lineSpacing: number }) {
      React.useEffect(() => () => rendererMocks.amllUnmounted(), []);
      return React.createElement('div', {
        'data-testid': 'mock-amll-renderer',
        'data-font-size': props.fontSize,
        'data-line-spacing': props.lineSpacing,
      });
    },
  };
});

import FocusLyrics, { type FocusLyricsProps } from '@/components/focus-mode/FocusLyrics';

const track: Track = {
  id: 'renderer-track',
  title: 'Renderer Test',
  artist: 'LyricsAdapter',
  album: 'Tests',
  duration: 10,
  audioUrl: 'blob:test',
  syncedLyrics: [{ time: 1, text: 'One lyric line' }],
};

const baseProps: FocusLyricsProps = {
  track,
  currentTime: 2,
  currentTimeRef: { current: 2 },
  isPlaying: false,
  isVisible: true,
  useAmlLyrics: false,
  fontSize: 30,
  lineSpacing: 24,
  inactiveBlur: 2,
  textPrimary: '#fff',
  textSecondary: '#ccc',
  textMuted: '#777',
  onSeek: vi.fn(),
};

describe('FocusLyrics', () => {
  it('keeps lyric typography at the configured size while its viewport grows', async () => {
    const { rerender } = render(<FocusLyrics {...baseProps} fontSize={34} lineSpacing={28} />);

    expect(screen.getByTestId('mock-legacy-renderer')).toHaveAttribute('data-font-size', '34');
    expect(screen.getByTestId('mock-legacy-renderer')).toHaveAttribute('data-line-spacing', '28');
    expect(screen.getByTestId('mock-legacy-renderer').parentElement).toHaveClass('focus-lyrics-viewport');

    rerender(<FocusLyrics {...baseProps} useAmlLyrics fontSize={34} lineSpacing={28} />);
    const amlRenderer = await screen.findByTestId('mock-amll-renderer');
    expect(amlRenderer).toHaveAttribute('data-font-size', '34');
    expect(amlRenderer).toHaveAttribute('data-line-spacing', '28');
    expect(screen.getByTestId('focus-amll-lyrics')).toHaveClass('focus-lyrics-viewport');
  });

  it('defaults to legacy and fully swaps renderers when the experiment changes', async () => {
    rendererMocks.legacyUnmounted.mockClear();
    rendererMocks.amllUnmounted.mockClear();
    const { rerender } = render(<FocusLyrics {...baseProps} />);

    expect(screen.getByTestId('mock-legacy-renderer')).toBeInTheDocument();
    expect(screen.queryByTestId('mock-amll-renderer')).not.toBeInTheDocument();

    rerender(<FocusLyrics {...baseProps} useAmlLyrics />);
    expect(await screen.findByTestId('mock-amll-renderer')).toBeInTheDocument();
    expect(screen.queryByTestId('mock-legacy-renderer')).not.toBeInTheDocument();
    expect(rendererMocks.legacyUnmounted).toHaveBeenCalledOnce();

    rerender(<FocusLyrics {...baseProps} useAmlLyrics={false} />);
    expect(screen.getByTestId('mock-legacy-renderer')).toBeInTheDocument();
    await waitFor(() => expect(rendererMocks.amllUnmounted).toHaveBeenCalledOnce());
    expect(screen.queryByTestId('mock-amll-renderer')).not.toBeInTheDocument();
  });
});
