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
