import { useSyncExternalStore } from 'react';
import type { PaletteCommand } from '../commands/paletteCommand';

export type PaletteMode = 'library' | 'commands';

export const PALETTE_MODES: readonly PaletteMode[] = ['library', 'commands'];

export interface CommandPaletteState {
  open: boolean;
  mode: PaletteMode;
  query: string;
  /** Ids of nested command lists entered with Enter/Tab; the last one is shown.
   *  Ids, not objects, so a nested list re-reads live state on every render. */
  stack: readonly string[];
}

export type CommandPaletteEvent =
  | { type: 'open'; mode?: PaletteMode }
  | { type: 'close' }
  | { type: 'toggle' }
  | { type: 'setQuery'; query: string }
  | { type: 'cycleMode' }
  | { type: 'push'; commandId: string }
  | { type: 'pop' }
  /** Esc: leave a nested list, then clear the query, then close. */
  | { type: 'back' };

export const initialCommandPaletteState: CommandPaletteState = {
  open: false,
  mode: 'library',
  query: '',
  stack: [],
};

const opened = (mode: PaletteMode): CommandPaletteState => ({ open: true, mode, query: '', stack: [] });

export function commandPaletteReducer(state: CommandPaletteState, event: CommandPaletteEvent): CommandPaletteState {
  switch (event.type) {
    case 'open':
      return opened(event.mode ?? 'library');
    case 'close':
      return initialCommandPaletteState;
    case 'toggle':
      return state.open ? initialCommandPaletteState : opened('library');
    case 'setQuery':
      return { ...state, query: event.query };
    case 'cycleMode': {
      const next = PALETTE_MODES[(PALETTE_MODES.indexOf(state.mode) + 1) % PALETTE_MODES.length]!;
      return { ...state, mode: next, stack: [] };
    }
    case 'push':
      return { ...state, mode: 'commands', query: '', stack: [...state.stack, event.commandId] };
    case 'pop':
      return { ...state, query: '', stack: state.stack.slice(0, -1) };
    case 'back':
      if (state.stack.length > 0) return { ...state, query: '', stack: state.stack.slice(0, -1) };
      if (state.query) return { ...state, query: '' };
      return initialCommandPaletteState;
  }
}

export interface CommandPaletteStore {
  getState: () => CommandPaletteState;
  subscribe: (listener: () => void) => () => void;
  open: (mode?: PaletteMode) => void;
  close: () => void;
  toggle: () => void;
  setQuery: (query: string) => void;
  cycleMode: () => void;
  push: (command: PaletteCommand) => void;
  pop: () => void;
  back: () => void;
}

/**
 * Palette state lives outside React's tree so typing only re-renders the
 * palette; shortcuts call the actions without subscribing.
 */
export function createCommandPaletteStore(): CommandPaletteStore {
  let state = initialCommandPaletteState;
  const listeners = new Set<() => void>();
  const dispatch = (event: CommandPaletteEvent) => {
    const next = commandPaletteReducer(state, event);
    if (next === state) return;
    state = next;
    listeners.forEach(listener => listener());
  };
  return {
    getState: () => state,
    subscribe: listener => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    open: mode => dispatch(mode ? { type: 'open', mode } : { type: 'open' }),
    close: () => dispatch({ type: 'close' }),
    toggle: () => dispatch({ type: 'toggle' }),
    setQuery: query => dispatch({ type: 'setQuery', query }),
    cycleMode: () => dispatch({ type: 'cycleMode' }),
    push: command => dispatch({ type: 'push', commandId: command.id }),
    pop: () => dispatch({ type: 'pop' }),
    back: () => dispatch({ type: 'back' }),
  };
}

export const commandPalette = createCommandPaletteStore();

export function useCommandPaletteState(store: CommandPaletteStore = commandPalette): CommandPaletteState {
  return useSyncExternalStore(store.subscribe, store.getState);
}
