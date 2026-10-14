import { createContext, useContext } from 'react';
import { createEmptySlot, type LibrarySlot, type SlotId } from '../types';
import { createStore, useStoreSelector, type Store } from './createStore';

/**
 * Library domain state: the four slots, the play context and the browsed
 * source. One store instance is created by the composition root.
 *
 * Writes go only through the library and player owners (useLibrarySlots and
 * the controllers built on it). Components read slices with
 * `useLibraryState(selector)` and emit intent through callbacks.
 */
export interface LibraryState {
  slots: Record<SlotId, LibrarySlot>;
  /** Slot that owns playback. */
  activeSlotId: SlotId;
  /** Slot shown in the library view; 'playlist' only while browsing one. */
  viewSlot: SlotId;
}

export type LibraryStateStore = Store<LibraryState>;

export function createLibraryState(): LibraryStateStore {
  return createStore<LibraryState>({
    slots: {
      local: createEmptySlot('local'),
      cloud: createEmptySlot('cloud'),
      online: createEmptySlot('online'),
      playlist: createEmptySlot('playlist'),
    },
    activeSlotId: 'local',
    viewSlot: 'local',
  });
}

const LibraryStateContext = createContext<LibraryStateStore | null>(null);

export const LibraryStateProvider = LibraryStateContext.Provider;

export function useLibraryState<S>(selector: (state: LibraryState) => S): S {
  const store = useContext(LibraryStateContext);
  if (!store) throw new Error('useLibraryState must be used inside LibraryStateProvider');
  return useStoreSelector(store, selector);
}
