import { logger } from './logger';

export interface ShortcutConfig {
  id: string;
  name: string;
  description: string;
  defaultKey: string;
  currentKey: string;
  scope: 'global' | 'player' | 'navigation';
}

export type ShortcutAction = 
  | 'playPause'
  | 'skipForward'
  | 'skipBackward'
  | 'seekForward5s'
  | 'seekBackward5s'
  | 'seekForward30s'
  | 'seekBackward30s'
  | 'volumeUp'
  | 'volumeDown'
  | 'volumeUp10'
  | 'volumeDown10'
  | 'toggleMute'
  | 'togglePlaybackMode'
  | 'toggleFocusMode'
  | 'focusSearch'
  | 'importFiles'
  | 'gotoLibrary'
  | 'gotoBrowse'
  | 'gotoSettings'
  | 'gotoTheme'
  | 'gotoMetadata';

export const DEFAULT_SHORTCUTS: Record<ShortcutAction, ShortcutConfig> = {
  playPause: {
    id: 'playPause',
    name: 'shortcut.playPause',
    description: 'shortcut.playPauseDesc',
    defaultKey: 'Space',
    currentKey: 'Space',
    scope: 'player'
  },
  skipForward: {
    id: 'skipForward',
    name: 'shortcut.nextTrack',
    description: 'shortcut.nextTrackDesc',
    defaultKey: 'CmdOrCtrl+Right',
    currentKey: 'CmdOrCtrl+Right',
    scope: 'player'
  },
  skipBackward: {
    id: 'skipBackward',
    name: 'shortcut.prevTrack',
    description: 'shortcut.prevTrackDesc',
    defaultKey: 'CmdOrCtrl+Left',
    currentKey: 'CmdOrCtrl+Left',
    scope: 'player'
  },
  seekForward5s: {
    id: 'seekForward5s',
    name: 'shortcut.seekForward5s',
    description: 'shortcut.seekForward5sDesc',
    defaultKey: 'Right',
    currentKey: 'Right',
    scope: 'player'
  },
  seekBackward5s: {
    id: 'seekBackward5s',
    name: 'shortcut.seekBackward5s',
    description: 'shortcut.seekBackward5sDesc',
    defaultKey: 'Left',
    currentKey: 'Left',
    scope: 'player'
  },
  seekForward30s: {
    id: 'seekForward30s',
    name: 'shortcut.seekForward30s',
    description: 'shortcut.seekForward30sDesc',
    defaultKey: 'Alt+Right',
    currentKey: 'Alt+Right',
    scope: 'player'
  },
  seekBackward30s: {
    id: 'seekBackward30s',
    name: 'shortcut.seekBackward30s',
    description: 'shortcut.seekBackward30sDesc',
    defaultKey: 'Alt+Left',
    currentKey: 'Alt+Left',
    scope: 'player'
  },
  volumeUp: {
    id: 'volumeUp',
    name: 'shortcut.volumeUp',
    description: 'shortcut.volumeUpDesc',
    defaultKey: 'Up',
    currentKey: 'Up',
    scope: 'player'
  },
  volumeDown: {
    id: 'volumeDown',
    name: 'shortcut.volumeDown',
    description: 'shortcut.volumeDownDesc',
    defaultKey: 'Down',
    currentKey: 'Down',
    scope: 'player'
  },
  volumeUp10: {
    id: 'volumeUp10',
    name: 'shortcut.volumeUp10',
    description: 'shortcut.volumeUp10Desc',
    defaultKey: 'Alt+Up',
    currentKey: 'Alt+Up',
    scope: 'player'
  },
  volumeDown10: {
    id: 'volumeDown10',
    name: 'shortcut.volumeDown10',
    description: 'shortcut.volumeDown10Desc',
    defaultKey: 'Alt+Down',
    currentKey: 'Alt+Down',
    scope: 'player'
  },
  toggleMute: {
    id: 'toggleMute',
    name: 'shortcut.toggleMute',
    description: 'shortcut.toggleMuteDesc',
    defaultKey: 'M',
    currentKey: 'M',
    scope: 'player'
  },
  togglePlaybackMode: {
    id: 'togglePlaybackMode',
    name: 'shortcut.togglePlaybackMode',
    description: 'shortcut.togglePlaybackModeDesc',
    defaultKey: 'Tab',
    currentKey: 'Tab',
    scope: 'player'
  },
  toggleFocusMode: {
    id: 'toggleFocusMode',
    name: 'shortcut.toggleFocusMode',
    description: 'shortcut.toggleFocusModeDesc',
    defaultKey: 'CmdOrCtrl+Enter',
    currentKey: 'CmdOrCtrl+Enter',
    scope: 'navigation'
  },
  focusSearch: {
    id: 'focusSearch',
    name: 'shortcut.focusSearch',
    description: 'shortcut.focusSearchDesc',
    defaultKey: 'CmdOrCtrl+F',
    currentKey: 'CmdOrCtrl+F',
    scope: 'navigation'
  },
  importFiles: {
    id: 'importFiles',
    name: 'shortcut.importFiles',
    description: 'shortcut.importFilesDesc',
    defaultKey: 'CmdOrCtrl+I',
    currentKey: 'CmdOrCtrl+I',
    scope: 'navigation'
  },
  gotoLibrary: {
    id: 'gotoLibrary',
    name: 'shortcut.gotoLibrary',
    description: 'shortcut.gotoLibraryDesc',
    defaultKey: 'CmdOrCtrl+L',
    currentKey: 'CmdOrCtrl+L',
    scope: 'navigation'
  },
  gotoBrowse: {
    id: 'gotoBrowse',
    name: 'shortcut.gotoBrowse',
    description: 'shortcut.gotoBrowseDesc',
    defaultKey: 'CmdOrCtrl+B',
    currentKey: 'CmdOrCtrl+B',
    scope: 'navigation'
  },
  gotoSettings: {
    id: 'gotoSettings',
    name: 'shortcut.gotoSettings',
    description: 'shortcut.gotoSettingsDesc',
    defaultKey: 'CmdOrCtrl+,',
    currentKey: 'CmdOrCtrl+,',
    scope: 'navigation'
  },
  gotoTheme: {
    id: 'gotoTheme',
    name: 'shortcut.gotoTheme',
    description: 'shortcut.gotoThemeDesc',
    defaultKey: 'CmdOrCtrl+T',
    currentKey: 'CmdOrCtrl+T',
    scope: 'navigation'
  },
  gotoMetadata: {
    id: 'gotoMetadata',
    name: 'shortcut.gotoMetadata',
    description: 'shortcut.gotoMetadataDesc',
    defaultKey: 'CmdOrCtrl+Shift+M',
    currentKey: 'CmdOrCtrl+Shift+M',
    scope: 'navigation'
  }
};

const STORAGE_KEY = 'app-shortcuts';

class ShortcutManager {
  private shortcuts: Record<ShortcutAction, ShortcutConfig>;
  private listeners: Set<(action: ShortcutAction) => void> = new Set();

  constructor() {
    this.shortcuts = this.loadShortcuts();
  }

  private loadShortcuts(): Record<ShortcutAction, ShortcutConfig> {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        // Start with defaults, then merge saved values
        const merged = { ...DEFAULT_SHORTCUTS };
        for (const key of Object.keys(DEFAULT_SHORTCUTS) as ShortcutAction[]) {
          if (parsed[key]) {
            merged[key] = { ...DEFAULT_SHORTCUTS[key], ...parsed[key] };
          }
        }
        return merged;
      }
    } catch (e) {
      logger.error('[Shortcuts] Failed to load shortcuts:', e);
    }
    return { ...DEFAULT_SHORTCUTS };
  }

  private saveShortcuts(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.shortcuts));
    } catch (e) {
      logger.error('[Shortcuts] Failed to save shortcuts:', e);
    }
  }

  getAllShortcuts(): Record<ShortcutAction, ShortcutConfig> {
    return { ...this.shortcuts };
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
      .replace('Escape', 'Esc');
  }

  // Check if an input event matches a shortcut
  matchesShortcut(action: ShortcutAction, event: KeyboardEvent): boolean {
    const shortcut = this.shortcuts[action];
    if (!shortcut || !shortcut.currentKey) return false;

    const parts = shortcut.currentKey.split('+');
    let key = parts[parts.length - 1];
    const needsCtrl = parts.includes('CmdOrCtrl') || parts.includes('Ctrl') || parts.includes('Cmd');
    const needsAlt = parts.includes('Alt');
    const needsShift = parts.includes('Shift');

    // Handle special keys - map config key names to event.key values
    const keyMap: Record<string, string> = {
      'Space': ' ',
      'Left': 'ArrowLeft',
      'Right': 'ArrowRight',
      'Up': 'ArrowUp',
      'Down': 'ArrowDown',
      'Enter': 'Enter',
      'Escape': 'Escape',
      ',': ','
    };
    
    // Get the expected event.key value (try both original and lowercase for letters)
    const expectedKey = keyMap[key] || key;
    const expectedKeyLower = expectedKey.toLowerCase();

    const ctrlMatch = needsCtrl === (event.ctrlKey || event.metaKey);
    const altMatch = needsAlt === event.altKey;
    const shiftMatch = needsShift === event.shiftKey;
    
    // For letter keys, event.key can be lowercase when combined with modifiers
    const keyMatch = event.key === expectedKey || event.key === expectedKeyLower;
    
    // Debug log for debugging
    if (needsCtrl || needsAlt) {
      logger.debug('[Shortcuts] Matching:', {
        action,
        configKey: shortcut.currentKey,
        expectedKey,
        expectedKeyLower,
        eventKey: event.key,
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
