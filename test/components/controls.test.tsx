import type { ComponentProps } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import Controls from '@/components/Controls';
import type { Track } from '@/types';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@/hooks/useGlassUI', () => ({ useGlassUI: () => false }));
vi.mock('@/components/OverflowMarquee', () => ({ default: ({ text }: { text: string }) => <span>{text}</span> }));

const track: Track = { id: 'preview', title: 'Test track', artist: 'Artist', album: 'Album', duration: 180, audioUrl: '' };

function props(overrides: Partial<ComponentProps<typeof Controls>> = {}): ComponentProps<typeof Controls> {
  return {
    track, isPlaying: false, currentTime: 30, volume: 0.5, playbackMode: 'order', isFocusMode: false,
    onTogglePlay: vi.fn(), onSkipNext: vi.fn(), onSkipPrev: vi.fn(), onSeek: vi.fn(),
    onVolumeChange: vi.fn(), onToggleMute: vi.fn(), onTogglePlaybackMode: vi.fn(), onToggleFocus: vi.fn(),
    ...overrides,
  };
}

describe('Controls progress and volume sliders', () => {
  it('keeps native control keys away from global shortcuts while preserving modifiers', () => {
    const onAppShortcut = vi.fn();
    render(<div onKeyDown={onAppShortcut}><Controls {...props()} /></div>);
    expect(fireEvent.keyDown(screen.getByRole('slider', { name: 'controls.volume' }), { key: 'ArrowUp' })).toBe(true);
    expect(fireEvent.keyDown(screen.getByRole('slider', { name: 'controls.seek' }), { key: 'ArrowRight' })).toBe(true);
    expect(onAppShortcut).not.toHaveBeenCalled();
    fireEvent.keyDown(screen.getByRole('slider', { name: 'controls.seek' }), { key: 'ArrowRight', ctrlKey: true });
    expect(onAppShortcut).toHaveBeenCalledOnce();
  });

  it('disables seeking without a track while keeping volume available', () => {
    render(<Controls {...props({ track: null })} />);
    expect(screen.getByRole('slider', { name: 'controls.seek' })).toBeDisabled();
    expect(screen.getByRole('slider', { name: 'controls.volume' })).toBeEnabled();
  });

  it('keeps the slider within duration and forwards seek and volume changes', () => {
    const callbacks = props({ currentTime: 300 });
    const { rerender } = render(<Controls {...callbacks} />);
    const seek = screen.getByRole('slider', { name: 'controls.seek' });
    expect(seek).toHaveValue('180');
    expect(seek).toHaveAttribute('aria-valuetext', '3:00 / 3:00');
    fireEvent.change(seek, { target: { value: '60' } });
    expect(callbacks.onSeek).toHaveBeenCalledWith(60);
    fireEvent.change(screen.getByRole('slider', { name: 'controls.volume' }), { target: { value: '0.75' } });
    expect(callbacks.onVolumeChange).toHaveBeenCalledWith(0.75);

    rerender(<Controls {...callbacks} track={{ ...track, duration: 0 }} />);
    expect(seek).toBeDisabled();
    expect(seek).toHaveValue('0');
  });
});
