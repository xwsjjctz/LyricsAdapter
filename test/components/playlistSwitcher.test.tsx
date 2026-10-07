import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import PlaylistSwitcher from '@/components/playlist-switcher/PlaylistSwitcher';
import type { PlaylistSwitchItem } from '@/components/playlist-switcher/types';
import { shortcutManager } from '@/services/shortcuts';
import { commandPalette } from '@/hooks/useCommandPalette';
import { controlbarPresentation } from '@/hooks/usePlayerControlbar';

const key = (key: string, extra: KeyboardEventInit = {}) => fireEvent.keyDown(window, { key, ...extra });
const cycle = (extra: KeyboardEventInit = {}) => key('`', { code: 'Backquote', metaKey: true, ...extra });
const release = () => fireEvent.keyUp(window, { key: 'Meta', metaKey: false });
const selected = () => screen.getByRole('option', { selected: true });
function setup(count = 3) {
  const items: PlaylistSwitchItem[] = Array.from({ length: count }, (_, index) => ({
    id: `list-${index}`, name: `Playlist ${index}`, detail: '10 tracks', icon: 'queue_music', run: vi.fn(),
  }));
  return { items, ...render(<PlaylistSwitcher items={items} activeId={items[0]!.id} />) };
}
beforeEach(() => { shortcutManager.resetAllToDefaults(); commandPalette.close(); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('Playlist switcher gesture', () => {
  it('keeps the native controlbar visible through the background without treating the panel as transparent', () => {
    setup(); cycle();
    const anchor = document.createElement('div');
    anchor.style.opacity = '1';
    document.body.appendChild(anchor);
    vi.spyOn(anchor, 'getBoundingClientRect').mockReturnValue({
      x: 20, y: 700, left: 20, top: 700, right: 420, bottom: 764,
      width: 400, height: 64, toJSON: () => ({}),
    });
    const hitTest = vi.fn().mockReturnValue(document.querySelector('.playlist-switcher-backdrop'));
    Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: hitTest });
    try {
      expect(controlbarPresentation(anchor, true).opacity).toBe(1);
      hitTest.mockReturnValue(screen.getByRole('dialog'));
      expect(controlbarPresentation(anchor, true).opacity).toBe(0);
    } finally { anchor.remove(); }
  });
  it('alternates rapid separate Ctrl+Backquote chords between the last two of three lists', () => {
    const { items } = setup();
    const controlCycle = () => cycle({ key: '~', metaKey: false, ctrlKey: true });
    const controlRelease = () => fireEvent.keyUp(window, { key: 'Control', ctrlKey: false });
    // Navigate to the third list while holding Ctrl; one chord after release
    // must return to list 0, rather than continue around the fixed list.
    controlCycle(); controlCycle(); controlRelease();
    expect(items[2]!.run).toHaveBeenCalledTimes(1);
    for (const index of [0, 2, 0, 2]) {
      controlCycle(); expect(selected()).toHaveAccessibleName(`Playlist ${index}`); controlRelease();
    }
    expect(items[0]!.run).toHaveBeenCalledTimes(2);
    expect(items[2]!.run).toHaveBeenCalledTimes(3);
    expect(items[1]!.run).not.toHaveBeenCalled();
  });
  it('cycles through frozen recency order while held and remembers only the committed selection', () => {
    const { items } = setup();
    cycle(); cycle(); release(); // 2, 0, 1
    cycle(); expect(selected()).toHaveAccessibleName('Playlist 0');
    expect(screen.getAllByRole('option').map(item => item.getAttribute('aria-label')))
      .toEqual(['Playlist 2', 'Playlist 0', 'Playlist 1']);
    cycle(); expect(selected()).toHaveAccessibleName('Playlist 1');
    cycle(); expect(selected()).toHaveAccessibleName('Playlist 2');
    cycle({ shiftKey: true }); expect(selected()).toHaveAccessibleName('Playlist 1');
    key('Escape'); release();
    cycle(); expect(selected()).toHaveAccessibleName('Playlist 0'); release();
    cycle(); expect(selected()).toHaveAccessibleName('Playlist 2'); release();
    expect(items[1]!.run).not.toHaveBeenCalled();
  });
  it('includes visits outside the shortcut in recency and skips removed lists on the next gesture', () => {
    const { items, rerender } = setup();
    rerender(<PlaylistSwitcher items={items} activeId={items[2]!.id} />);
    rerender(<PlaylistSwitcher items={items} activeId={items[1]!.id} />);
    cycle(); expect(selected()).toHaveAccessibleName('Playlist 2'); release();
    rerender(<PlaylistSwitcher items={items} activeId={items[2]!.id} />);
    rerender(<PlaylistSwitcher items={[items[0]!, items[2]!]} activeId={items[2]!.id} />);
    cycle(); expect(selected()).toHaveAccessibleName('Playlist 0');
    expect(screen.getAllByRole('option')).toHaveLength(2);
    release(); expect(items[0]!.run).toHaveBeenCalledTimes(1);
  });
  it('previews a full list, cycles and reverses, then commits once on modifier release', () => {
    const { items } = setup(9);
    cycle();
    expect(screen.getAllByRole('option')).toHaveLength(9);
    expect(selected()).toHaveAccessibleName('Playlist 1');
    cycle(); expect(selected()).toHaveAccessibleName('Playlist 2');
    cycle({ shiftKey: true, key: '~' }); expect(selected()).toHaveAccessibleName('Playlist 1');
    for (const item of items) expect(item.run).not.toHaveBeenCalled();
    fireEvent.keyUp(window, { key: 'Control' });
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    release(); release();
    expect(items[1]!.run).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
  it('wraps reverse selection and confirms with Enter without double committing', () => {
    const { items } = setup();
    cycle({ shiftKey: true }); expect(selected()).toHaveAccessibleName('Playlist 2');
    key('ArrowLeft'); expect(selected()).toHaveAccessibleName('Playlist 1');
    key('Tab', { shiftKey: true }); expect(selected()).toHaveAccessibleName('Playlist 0');
    key('Enter'); release();
    expect(items[0]!.run).toHaveBeenCalledTimes(1);
  });
  it('cancels on Escape, outside click and window blur without opening a playlist', () => {
    const { items } = setup();
    cycle(); key('Escape'); release();
    cycle(); fireEvent.mouseDown(document.querySelector('.playlist-switcher-backdrop')!); release();
    cycle(); fireEvent.blur(window); release();
    for (const item of items) expect(item.run).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
  it('keeps selection away from playback shortcuts and ignores repeat cycling', () => {
    setup(); cycle();
    const globalPlayback = vi.fn();
    window.addEventListener('keydown', globalPlayback);
    try {
      cycle({ repeat: true }); expect(selected()).toHaveAccessibleName('Playlist 1');
      key(' '); key('ArrowRight');
      expect(globalPlayback).not.toHaveBeenCalled();
      expect(selected()).toHaveAccessibleName('Playlist 2');
    } finally { window.removeEventListener('keydown', globalPlayback); }
  });
  it('freezes order during background refresh and does not open a removed item', () => {
    const { items, rerender } = setup(); cycle();
    rerender(<PlaylistSwitcher items={[items[2]!, items[0]!]} activeId={items[0]!.id} />);
    expect(screen.getAllByRole('option').map(item => item.getAttribute('aria-label'))).toEqual(['Playlist 0', 'Playlist 1', 'Playlist 2']);
    release();
    expect(items[1]!.run).not.toHaveBeenCalled();
  });
  it('supports custom bindings and leaves the shortcut recorder alone', () => {
    const { items } = setup();
    shortcutManager.updateShortcut('cyclePlaylists', 'Ctrl+J');
    cycle(); expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    const input = document.createElement('input'); input.setAttribute('data-shortcut-recorder', ''); document.body.append(input);
    fireEvent.keyDown(input, { key: 'j', ctrlKey: true }); expect(screen.queryByRole('dialog')).not.toBeInTheDocument(); input.remove();
    key('j', { ctrlKey: true }); expect(selected()).toHaveAccessibleName('Playlist 1');
    fireEvent.keyUp(window, { key: 'Control', ctrlKey: false }); expect(items[1]!.run).toHaveBeenCalledTimes(1);
  });
  it('handles synchronous press/release events and clicking a different card', () => {
    const { items } = setup();
    act(() => { cycle(); release(); cycle(); release(); cycle(); release(); });
    expect(items[1]!.run).toHaveBeenCalledTimes(2);
    expect(items[0]!.run).toHaveBeenCalledTimes(1);
    cycle(); fireEvent.click(screen.getByRole('option', { name: 'Playlist 2' })); release();
    expect(items[2]!.run).toHaveBeenCalledTimes(1);
  });
  it('does not replace keyboard selection under a stationary pointer', () => {
    setup(); cycle();
    const first = screen.getByRole('option', { name: 'Playlist 0' });
    fireEvent.mouseEnter(first);
    fireEvent.mouseMove(first);
    expect(selected()).toHaveAccessibleName('Playlist 1');
    const move = new MouseEvent('mousemove', { bubbles: true });
    Object.defineProperty(move, 'movementX', { value: 4 });
    fireEvent(first, move);
    expect(selected()).toHaveAccessibleName('Playlist 0');
  });
  it('closes the command palette and restores input focus when cancelled', () => {
    setup();
    const input = document.createElement('input'); document.body.append(input); input.focus(); commandPalette.open();
    cycle(); expect(commandPalette.getState().open).toBe(false);
    expect(screen.getByRole('listbox')).toHaveFocus();
    key('Escape'); expect(input).toHaveFocus(); input.remove();
  });
});
