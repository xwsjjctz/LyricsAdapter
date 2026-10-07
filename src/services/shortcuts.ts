import { logger } from './logger';
import { appStorage } from './appStorage';

import { DEFAULT_SHORTCUTS, resolveShortcutKey, type ShortcutAction, type ShortcutConfig } from '../constants/shortcuts';
export type { ShortcutAction, ShortcutConfig } from '../constants/shortcuts';

const STORAGE_KEY = 'app-shortcuts';

class ShortcutManager {
  private shortcuts: Record<ShortcutAction, ShortcutConfig>;
  private listeners: Set<(action: ShortcutAction) => void> = new Set();

  constructor() {
    this.shortcuts = this.loadShortcuts();
  }

  /** Platform-specific key overrides to avoid OS shortcut conflicts */
  private static PLATFORM_DEFAULTS: Partial<Record<ShortcutAction, Record<string, string>>> = {};

  private getPlatform(): string {
    const p = navigator.platform;
    if (p.includes('Mac')) return 'darwin';
    if (p.includes('Win')) return 'win32';
    return 'linux';
  }

  private loadShortcuts(): Record<ShortcutAction, ShortcutConfig> {
    // Apply platform-specific defaults first
    const defaults = { ...DEFAULT_SHORTCUTS };
    const platform = this.getPlatform();

    for (const [action, platformMap] of Object.entries(ShortcutManager.PLATFORM_DEFAULTS) as [ShortcutAction, Record<string, string>][]) {
      const platformKey = platformMap[platform];
      if (platformKey && defaults[action]) {
        defaults[action] = {
          ...defaults[action],
          defaultKey: platformKey,
          currentKey: platformKey,
        };
      }
    }

    try {
      const saved = appStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        const merged = { ...defaults };
        for (const key of Object.keys(defaults) as ShortcutAction[]) {
          if (parsed[key]) {
            merged[key] = { ...defaults[key], ...parsed[key] };
            if (key === 'importMusic') {
              merged[key].defaultKey = defaults[key].defaultKey;
              merged[key].currentKey = resolveShortcutKey(key, parsed[key]);
            }
          }
        }
        return merged;
      }
    } catch (e) {
      logger.error('[Shortcuts] Failed to load shortcuts:', e);
    }
    return defaults;
  }

  private saveShortcuts(): void {
    try {
      appStorage.setItem(STORAGE_KEY, JSON.stringify(this.shortcuts)).catch(() => {});
    } catch (e) {
      logger.error('[Shortcuts] Failed to save shortcuts:', e);
    }
  }

  getAllShortcuts(): Record<ShortcutAction, ShortcutConfig> {
    return { ...this.shortcuts };
  }

  /** Refresh bindings after AppStorage has recovered from users.json. */
  reload(): void {
    this.shortcuts = this.loadShortcuts();
    logger.info('[Shortcuts] Bindings reloaded after settings recovery');
  }

  getShortcut(action: ShortcutAction): ShortcutConfig {
    return this.shortcuts[action];
  }

  updateShortcut(action: ShortcutAction, newKey: string): boolean {
    // Check for conflicts
    const conflict = this.findConflict(action, newKey);
    if (conflict && conflict !== action) {
      return false;
    }

    this.shortcuts[action] = {
      ...this.shortcuts[action],
      currentKey: newKey
    };
    this.saveShortcuts();
    return true;
  }

  resetToDefault(action: ShortcutAction): void {
    this.shortcuts[action] = {
      ...this.shortcuts[action],
      currentKey: this.shortcuts[action].defaultKey
    };
    this.saveShortcuts();
  }

  resetAllToDefaults(): void {
    this.shortcuts = { ...DEFAULT_SHORTCUTS };
    this.saveShortcuts();
  }

  findConflict(excludeAction: ShortcutAction, key: string): ShortcutAction | null {
    for (const [action, config] of Object.entries(this.shortcuts)) {
      if (action !== excludeAction && config.currentKey === key) {
        return action as ShortcutAction;
      }
    }
    return null;
  }

  // Convert shortcut key to display format
  formatKeyForDisplay(key: string): string {
    return key
      .replace('CmdOrCtrl+', 'Cmd/Ctrl+')
      .replace('Ctrl+', 'Ctrl+')
      .replace('Cmd+', 'Cmd+')
      .replace('Alt+', 'Option/Alt+')
      .replace('Shift+', 'Shift+')
      .replace('Left', 'Left')
      .replace('Right', 'Right')
      .replace('Up', 'Up')
      .replace('Down', 'Down')
      .replace('Space', 'Space')
      .replace('Enter', 'Enter')
      .replace('Escape', 'Esc')
      .replace('Backquote', '`');
  }

  // Check if an input event matches a shortcut
  matchesShortcut(action: ShortcutAction, event: KeyboardEvent, allowExtraShift = false): boolean {
    const shortcut = this.shortcuts[action];
    if (!shortcut || !shortcut.currentKey) return false;

    const parts = shortcut.currentKey.split('+');
    let key = parts[parts.length - 1];
    const needsCtrl = parts.includes('CmdOrCtrl') || parts.includes('Ctrl') || parts.includes('Cmd');
    const needsAlt = parts.includes('Alt');
    const needsShift = parts.includes('Shift');

    // Handle special keys with both event.key and event.code so default browser
    // scroll actions (notably Space in scrollable settings panes) are blocked reliably.
    const keyMap: Record<string, string[]> = {
      'Space': [' ', 'Space', 'Spacebar'],
      'Left': ['ArrowLeft'],
      'Right': ['ArrowRight'],
      'Up': ['ArrowUp'],
      'Down': ['ArrowDown'],
      'Enter': ['Enter'],
      'Escape': ['Escape'],
      'Tab': ['Tab'],
      ',': [','],
      'Backquote': ['`', '~', 'Backquote']
    };
    const codeMap: Record<string, string> = {
      'Space': 'Space',
      'Left': 'ArrowLeft',
      'Right': 'ArrowRight',
      'Up': 'ArrowUp',
      'Down': 'ArrowDown',
      'Enter': 'Enter',
      'Escape': 'Escape',
      'Tab': 'Tab',
      ',': 'Comma',
      'Backquote': 'Backquote'
    };
    
    // Get the expected event.key values (try lowercase too for letter shortcuts)
    const expectedKeys = keyMap[key!] || [key!];
    const expectedKeysLower = expectedKeys.map(k => k.toLowerCase());
    const expectedCode = codeMap[key!];

    const ctrlMatch = needsCtrl === (event.ctrlKey || event.metaKey);
    const altMatch = needsAlt === event.altKey;
    const shiftMatch = needsShift === event.shiftKey || (allowExtraShift && !needsShift && event.shiftKey);
    
    // For letter keys, event.key can be lowercase when combined with modifiers
    const keyMatch =
      expectedKeys.includes(event.key) ||
      expectedKeysLower.includes(event.key.toLowerCase()) ||
      (!!expectedCode && event.code === expectedCode);
    
    // Debug log for debugging
    if (needsCtrl || needsAlt) {
      logger.debug('[Shortcuts] Matching:', {
        action,
        configKey: shortcut.currentKey,
        expectedKeys,
        expectedCode,
        eventKey: event.key,
        eventCode: event.code,
        ctrl: event.ctrlKey,
        meta: event.metaKey,
        alt: event.altKey,
        ctrlMatch,
        altMatch,
        shiftMatch,
        keyMatch,
        result: ctrlMatch && altMatch && shiftMatch && keyMatch
      });
    }

    return ctrlMatch && altMatch && shiftMatch && keyMatch;
  }

  subscribe(listener: (action: ShortcutAction) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  emit(action: ShortcutAction): void {
    this.listeners.forEach(listener => listener(action));
  }
}

export const shortcutManager = new ShortcutManager();
