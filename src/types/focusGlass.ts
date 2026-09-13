export type PlaybackSymbol = 'skip_previous' | 'play_arrow' | 'pause' | 'skip_next'
  | 'repeat' | 'shuffle' | 'repeat_one' | 'volume_off' | 'volume_up' | 'open_in_full';
export type AppSymbol = PlaybackSymbol
  | 'add' | 'add_photo_alternate' | 'arrow_forward' | 'backspace' | 'check' | 'check_circle'
  | 'checkroom' | 'close' | 'cloud' | 'cloud_done' | 'cloud_off' | 'cloud_upload' | 'dark_mode'
  | 'delete' | 'delete_sweep' | 'description' | 'done' | 'download' | 'edit' | 'error'
  | 'expand_more' | 'folder_open' | 'hard_drive' | 'history' | 'info' | 'keyboard' | 'language'
  | 'left_panel_close' | 'left_panel_open' | 'library_music' | 'light_mode' | 'lightbulb'
  | 'music_note' | 'music_off' | 'my_location' | 'progress_activity' | 'qr_code_scanner'
  | 'queue_music' | 'refresh' | 'restart_alt' | 'science' | 'search' | 'search_off' | 'settings'
  | 'sync' | 'upload_file' | 'visibility' | 'visibility_off';
export type PlaybackSymbols = Partial<Record<AppSymbol, string>>;

/** Rectangle normalized to the renderer viewport; y starts at the top. */
export interface FocusGlassPresentation {
  x: number;
  y: number;
  width: number;
  height: number;
  opacity: number;
}

export interface FocusGlassState {
  visible: boolean;
  presentation: FocusGlassPresentation;
  darkMode: boolean;
  enabled: boolean;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  volume: number;
  playbackMode: 'order' | 'shuffle' | 'repeat-one';
  scale: number;
  labels: {
    playPause: string;
    previous: string;
    next: string;
    seek: string;
    volume: string;
    mute: string;
    mode: string;
  };
}

export type FocusGlassAction = {
  type: 'toggle-play' | 'previous' | 'next' | 'mode' | 'mute' | 'seek' | 'volume' | 'hover';
  value: number;
};
