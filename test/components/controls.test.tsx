import type { ComponentProps } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Controls from '@/components/Controls';
import type { Track } from '@/types';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@/components/OverflowMarquee', () => ({ default: ({ text }: { text: string }) => <span>{text}</span> }));
const desktop = vi.hoisted(() => ({ platform: 'win32' }));
vi.mock('@/services/desktopAdapter', () => ({ getDesktopAPI: () => desktop }));
beforeEach(() => {
  desktop.platform = 'win32';
  window.matchMedia = vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() });
});

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

describe('macOS volume panel fallback', () => {
  beforeEach(() => { desktop.platform = 'darwin'; vi.useFakeTimers(); });
  afterEach(() => vi.useRealTimers());

  it('reveals on hover without stealing focus, and only the original speaker toggles mute', () => {
    const callbacks = props();
    const { rerender } = render(<Controls {...callbacks} />);
    const button = screen.getByTestId('main-volume-button');
    fireEvent.mouseEnter(button);
    expect(button).toHaveAttribute('aria-expanded', 'true');
    const slider = screen.getByRole('slider', { name: 'controls.volume' });
    expect(slider).not.toHaveFocus();
    expect(slider).toHaveAttribute('aria-orientation', 'vertical');
    expect(callbacks.onToggleMute).not.toHaveBeenCalled();
    expect(screen.getByTestId('main-volume-disclosure').querySelectorAll('button')).toHaveLength(1);
    fireEvent.click(button);
    expect(callbacks.onToggleMute).toHaveBeenCalledOnce();
    rerender(<Controls {...callbacks} volume={0} />);
    expect(button).toHaveAccessibleName('controls.unmute');
    expect(screen.getByText('0%')).toBeVisible();
    fireEvent.click(button);
    expect(callbacks.onToggleMute).toHaveBeenCalledTimes(2);
    expect(button).toHaveAttribute('aria-expanded', 'true');
  });

  it('keeps a drag open beyond the hover grace period and closes after release outside', () => {
    const callbacks = props();
    render(<Controls {...callbacks} />);
    const button = screen.getByTestId('main-volume-button');
    fireEvent.mouseEnter(button);
    const slider = screen.getByRole('slider', { name: 'controls.volume' });
    fireEvent.pointerDown(slider);
    fireEvent.mouseLeave(screen.getByTestId('main-volume-disclosure'));
    act(() => vi.advanceTimersByTime(1000));
    expect(button).toHaveAttribute('aria-expanded', 'true');
    fireEvent.change(slider, { target: { value: '0.63' } });
    expect(callbacks.onVolumeChange).toHaveBeenCalledWith(0.63);
    fireEvent.pointerUp(document.body);
    act(() => vi.advanceTimersByTime(500));
    expect(button).toHaveAttribute('aria-expanded', 'false');
  });

  it('keeps keyboard focus open, then closes with Escape or focus mode', () => {
    const callbacks = props();
    const { rerender } = render(<Controls {...callbacks} />);
    const button = screen.getByTestId('main-volume-button');
    act(() => button.focus());
    fireEvent.keyDown(button, { key: 'ArrowUp' });
    expect(callbacks.onVolumeChange).toHaveBeenCalledWith(0.51);
    expect(callbacks.onToggleMute).not.toHaveBeenCalled();
    act(() => screen.getByRole('slider', { name: 'controls.volume' }).focus());
    fireEvent.mouseLeave(screen.getByTestId('main-volume-disclosure'));
    act(() => vi.advanceTimersByTime(1000));
    expect(button).toHaveAttribute('aria-expanded', 'true');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(button).toHaveFocus();
    expect(button).toHaveAttribute('aria-expanded', 'false');
    fireEvent.mouseEnter(button);
    rerender(<Controls {...callbacks} isFocusMode />);
    expect(button).toHaveAttribute('aria-expanded', 'false');
  });
});
