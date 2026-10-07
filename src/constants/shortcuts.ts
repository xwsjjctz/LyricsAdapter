export interface ShortcutConfig {
  id: string;
  name: string;
  description: string;
  defaultKey: string;
  currentKey: string;
  scope: 'global' | 'player' | 'navigation';
}

export type ShortcutAction =
  | 'importMusic'
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
  | 'toggleCommandPalette'
  | 'cyclePlaylists'
  | 'focusSearch'
  | 'gotoBrowse'
  | 'gotoSettings'
  | 'gotoMetadata';

export const DEFAULT_SHORTCUTS: Record<ShortcutAction, ShortcutConfig> = {
  importMusic: {
    id: 'importMusic',
    name: 'menu.importMusic',
    description: 'shortcut.importMusicDesc',
    defaultKey: 'CmdOrCtrl+I',
    currentKey: 'CmdOrCtrl+I',
    scope: 'global'
  },
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
  toggleCommandPalette: {
    id: 'toggleCommandPalette',
    name: 'shortcut.toggleCommandPalette',
    description: 'shortcut.toggleCommandPaletteDesc',
    defaultKey: 'CmdOrCtrl+K',
    currentKey: 'CmdOrCtrl+K',
    scope: 'global'
  },
  cyclePlaylists: {
    id: 'cyclePlaylists',
    name: 'shortcut.cyclePlaylists',
    description: 'shortcut.cyclePlaylistsDesc',
    defaultKey: 'CmdOrCtrl+Backquote',
    currentKey: 'CmdOrCtrl+Backquote',
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
  gotoMetadata: {
    id: 'gotoMetadata',
    name: 'shortcut.gotoMetadata',
    description: 'shortcut.gotoMetadataDesc',
    defaultKey: 'CmdOrCtrl+Shift+M',
    currentKey: 'CmdOrCtrl+Shift+M',
    scope: 'navigation'
  }
};

/** Keep saved bindings, upgrading the previous unchanged import default. */
export function resolveShortcutKey(action: ShortcutAction, saved: unknown): string {
  const fallback = DEFAULT_SHORTCUTS[action].currentKey;
  if (!saved || typeof saved !== 'object' || !('currentKey' in saved) || typeof saved.currentKey !== 'string') return fallback;
  if (action === 'importMusic' && saved.currentKey === 'CmdOrCtrl+O'
    && 'defaultKey' in saved && saved.defaultKey === 'CmdOrCtrl+O') return fallback;
  return saved.currentKey;
}
