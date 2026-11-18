import type { Track } from '../types';
import type { OnlineSource } from '../services/onlineMusicProvider';
import type { PlaylistLoadState } from '../controllers/usePlayerController';

/**
 * Third-party playlist browsing as the shell consumes it.
 *
 * A browsed playlist is shown from `browsingTracks`, not from the 'playlist'
 * play slot, so opening one never interrupts playback. `playTrack` is the
 * moment browsing becomes playing: the player controller commits the list to
 * the play slot. Thin composition only; the state lives in the controller.
 */
export interface PlaylistViewModel {
  loadState: PlaylistLoadState;
  browsingTracks: Track[];
  /** Show a playlist on the wall and start loading its first page. */
  open(source: OnlineSource, playlistId: string, title: string, totalTrackCount: number): Promise<void>;
  /** Load the next page of the browsed playlist. */
  loadMore(): Promise<void>;
  /** Play the browsed playlist from `index`. */
  playTrack(index: number): void;
}

export type PlaylistViewModelOptions = PlaylistViewModel;

export function usePlaylistViewModel(opts: PlaylistViewModelOptions): PlaylistViewModel {
  const { loadState, browsingTracks, open, loadMore, playTrack } = opts;
  return { loadState, browsingTracks, open, loadMore, playTrack };
}
