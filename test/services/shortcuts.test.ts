import { describe, it, expect, vi, beforeEach } from 'vitest';
import { shortcutManager } from '@/services/shortcuts';

beforeEach(() => {
  localStorage.clear();
  shortcutManager.resetAllToDefaults();
});

// ========== formatKeyForDisplay ==========
describe('formatKeyForDisplay', () => {
  it('should format CmdOrCtrl+ combo', () => {
    expect(shortcutManager.formatKeyForDisplay('CmdOrCtrl+S')).toBe('Cmd/Ctrl+S');
  });

  it('should format Alt+ combos', () => {
    expect(shortcutManager.formatKeyForDisplay('Alt+Right')).toBe('Option/Alt+Right');
  });

  it('should format simple keys', () => {
    expect(shortcutManager.formatKeyForDisplay('Space')).toBe('Space');
    expect(shortcutManager.formatKeyForDisplay('Tab')).toBe('Tab');
  });

  it('should format complex combos', () => {
    expect(shortcutManager.formatKeyForDisplay('Ctrl+Shift+M')).toBe('Ctrl+Shift+M');
    expect(shortcutManager.formatKeyForDisplay('CmdOrCtrl+Shift+M')).toBe('Cmd/Ctrl+Shift+M');
  });

  it('should format arrow keys', () => {
    expect(shortcutManager.formatKeyForDisplay('Left')).toBe('Left');
    expect(shortcutManager.formatKeyForDisplay('Up')).toBe('Up');
  });
});

// ========== findConflict ==========
describe('findConflict', () => {
  it('should return null when no conflict', () => {
    const conflict = shortcutManager.findConflict('playPause', 'Ctrl+Shift+Z');
    expect(conflict).toBeNull();
  });

  it('should return the conflicting action', () => {
    // playPause uses 'Space' by default
    // importFiles uses 'CmdOrCtrl+I' by default
    const conflict = shortcutManager.findConflict('importFiles', 'Space');
    expect(conflict).toBe('playPause');
  });

  it('should not count the excluded action as conflict', () => {
    const conflict = shortcutManager.findConflict('playPause', 'Space');
    expect(conflict).toBeNull();
  });

  it('should return null when key is empty', () => {
    // No shortcut has empty key, so this should be null
    const conflict = shortcutManager.findConflict('playPause', 'NonExistentKey');
    expect(conflict).toBeNull();
  });
});

// ========== matchesShortcut ==========
describe('matchesShortcut', () => {
  it('should match Space for playPause', () => {
    const event = new KeyboardEvent('keydown', { key: ' ' });
    expect(shortcutManager.matchesShortcut('playPause', event)).toBe(true);
  });

  it('should not match wrong key', () => {
    const event = new KeyboardEvent('keydown', { key: 'x' });
    expect(shortcutManager.matchesShortcut('playPause', event)).toBe(false);
  });

  it('should match Ctrl+Right for skipForward', () => {
    const event = new KeyboardEvent('keydown', {
      key: 'ArrowRight',
      ctrlKey: true,
    });
    expect(shortcutManager.matchesShortcut('skipForward', event)).toBe(true);
  });

  it('should accept either Ctrl or Meta for CmdOrCtrl combos', () => {
    const withCtrl = new KeyboardEvent('keydown', { key: 'ArrowRight', ctrlKey: true });
    const withMeta = new KeyboardEvent('keydown', { key: 'ArrowRight', metaKey: true });
    expect(shortcutManager.matchesShortcut('skipForward', withCtrl)).toBe(true);
    expect(shortcutManager.matchesShortcut('skipForward', withMeta)).toBe(true);
  });

  it('should require Alt modifier', () => {
    const withAlt = new KeyboardEvent('keydown', { key: 'ArrowRight', altKey: true });
    const withoutAlt = new KeyboardEvent('keydown', { key: 'ArrowRight' });
    expect(shortcutManager.matchesShortcut('seekForward30s', withAlt)).toBe(true);
    expect(shortcutManager.matchesShortcut('seekForward30s', withoutAlt)).toBe(false);
  });

  it('should require Shift modifier', () => {
    // gotoMetadata uses 'CmdOrCtrl+Shift+M'
    const withShift = new KeyboardEvent('keydown', {
      key: 'm',
      ctrlKey: true,
      shiftKey: true,
    });
    const withoutShift = new KeyboardEvent('keydown', {
      key: 'm',
      ctrlKey: true,
    });
    expect(shortcutManager.matchesShortcut('gotoMetadata', withShift)).toBe(true);
    expect(shortcutManager.matchesShortcut('gotoMetadata', withoutShift)).toBe(false);
  });

  it('should match arrow keys correctly', () => {
    const rightEvent = new KeyboardEvent('keydown', { key: 'ArrowRight' });
    const leftEvent = new KeyboardEvent('keydown', { key: 'ArrowLeft' });
    expect(shortcutManager.matchesShortcut('seekForward5s', rightEvent)).toBe(true);
    expect(shortcutManager.matchesShortcut('seekBackward5s', leftEvent)).toBe(true);
  });

  it('should map Space to event.key " "', () => {
    const event = new KeyboardEvent('keydown', { key: ' ' });
    expect(shortcutManager.matchesShortcut('playPause', event)).toBe(true);
  });

  it('should return false for unknown action', () => {
    const event = new KeyboardEvent('keydown', { key: ' ' });
    expect(shortcutManager.matchesShortcut('nonexistent' as any, event)).toBe(false);
  });
});

// ========== updateShortcut ==========
describe('updateShortcut', () => {
  it('should update a shortcut key when no conflict', () => {
    const result = shortcutManager.updateShortcut('playPause', 'Ctrl+Shift+P');
    expect(result).toBe(true);
    expect(shortcutManager.getShortcut('playPause').currentKey).toBe('Ctrl+Shift+P');
  });

  it('should return false when there is a conflict', () => {
    // importFiles uses 'CmdOrCtrl+I'; set playPause to conflict with it
    shortcutManager.updateShortcut('importFiles', 'Ctrl+I');
    const result = shortcutManager.updateShortcut('playPause', 'Ctrl+I');
    expect(result).toBe(false);
  });

  it('should persist the change to localStorage', () => {
    shortcutManager.updateShortcut('playPause', 'Ctrl+Shift+P');
    const saved = JSON.parse(localStorage.getItem('app-shortcuts') || '{}');
    expect(saved.playPause.currentKey).toBe('Ctrl+Shift+P');
  });
});

// ========== resetToDefault / resetAllToDefaults ==========
describe('resetToDefault', () => {
  it('should reset a single shortcut to its default key', () => {
    shortcutManager.updateShortcut('playPause', 'Ctrl+X');
    shortcutManager.resetToDefault('playPause');
    expect(shortcutManager.getShortcut('playPause').currentKey).toBe('Space');
  });
});

describe('resetAllToDefaults', () => {
  it('should reset all shortcuts to default keys', () => {
    shortcutManager.updateShortcut('playPause', 'Ctrl+X');
    shortcutManager.updateShortcut('skipForward', 'Ctrl+Y');
    shortcutManager.resetAllToDefaults();
    expect(shortcutManager.getShortcut('playPause').currentKey).toBe('Space');
    expect(shortcutManager.getShortcut('skipForward').currentKey).toBe('CmdOrCtrl+Right');
  });
});
