import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import ShortcutsSettings from '@/components/ShortcutsSettings';
import { shortcutManager } from '@/services/shortcuts';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
beforeEach(() => shortcutManager.resetAllToDefaults());
afterEach(() => { cleanup(); shortcutManager.resetAllToDefaults(); });

it('waits for a non-modifier key before saving a multi-modifier shortcut', () => {
  render(<ShortcutsSettings />);
  const row = screen.getByText('shortcut.toggleFocusMode').parentElement!;
  fireEvent.click(row.querySelector('button')!);
  const input = screen.getByPlaceholderText('settings.shortcuts.pressKey');
  fireEvent.keyDown(input, { key: 'Meta', metaKey: true });
  fireEvent.keyDown(input, { key: 'Shift', metaKey: true, shiftKey: true });
  expect(shortcutManager.getShortcut('toggleFocusMode').currentKey).toBe('CmdOrCtrl+Enter');
  expect(input).toBeInTheDocument();
  fireEvent.keyDown(input, { key: 'L', code: 'KeyL', metaKey: true, shiftKey: true });
  expect(shortcutManager.getShortcut('toggleFocusMode').currentKey).toBe('CmdOrCtrl+Shift+L');
  expect(screen.queryByPlaceholderText('settings.shortcuts.pressKey')).not.toBeInTheDocument();
});

it('returns focus to the shortcut button when the keyboard ends a recording', () => {
  render(<ShortcutsSettings />);
  const row = screen.getByText('shortcut.toggleFocusMode').parentElement!;
  const edit = () => row.querySelector<HTMLElement>('[data-shortcut-edit="toggleFocusMode"]')!;
  // Otherwise focus drops to the page body, where Escape no longer closes settings.
  fireEvent.click(edit());
  fireEvent.keyDown(screen.getByPlaceholderText('settings.shortcuts.pressKey'), { key: 'Escape' });
  expect(edit()).toHaveFocus();
  fireEvent.click(edit());
  fireEvent.keyDown(screen.getByPlaceholderText('settings.shortcuts.pressKey'), { key: 'L', code: 'KeyL', metaKey: true, shiftKey: true });
  expect(edit()).toHaveFocus();
});
