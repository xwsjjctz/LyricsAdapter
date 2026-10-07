/** Browsing intents; playback and playlist loading stay with their existing owners. */
export interface PlaylistSwitchItem {
  id: string;
  name: string;
  detail: string;
  icon: string;
  coverUrl?: string | undefined;
  run: () => void;
}
