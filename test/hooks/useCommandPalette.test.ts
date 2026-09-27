import { describe, expect, it, vi } from 'vitest';
import {
  commandPaletteReducer,
  createCommandPaletteStore,
  initialCommandPaletteState,
  type CommandPaletteState,
} from '@/hooks/useCommandPalette';

const open = (overrides: Partial<CommandPaletteState> = {}): CommandPaletteState => ({
  ...initialCommandPaletteState,
  open: true,
  ...overrides,
});

describe('commandPaletteReducer', () => {
  it('toggles open in library mode with a clean query', () => {
    const opened = commandPaletteReducer(initialCommandPaletteState, { type: 'toggle' });
    expect(opened).toEqual({ open: true, mode: 'library', query: '', stack: [] });
    expect(commandPaletteReducer(opened, { type: 'toggle' })).toBe(initialCommandPaletteState);
  });

  it('cycles modes, keeps the query and leaves nested lists', () => {
    const state = open({ mode: 'commands', query: 'eng', stack: ['appearance.language'] });
    expect(commandPaletteReducer(state, { type: 'cycleMode' })).toEqual(open({ mode: 'library', query: 'eng' }));
    expect(commandPaletteReducer(open({ query: 'eng' }), { type: 'cycleMode' }).mode).toBe('commands');
  });

  it('enters nested lists in feature mode and backs out step by step', () => {
    const nested = commandPaletteReducer(open({ query: 'lang' }), { type: 'push', commandId: 'appearance.language' });
    expect(nested).toEqual(open({ mode: 'commands', stack: ['appearance.language'] }));

    const typed = commandPaletteReducer(nested, { type: 'setQuery', query: 'en' });
    const leftNested = commandPaletteReducer(typed, { type: 'back' });
    expect(leftNested).toEqual(open({ mode: 'commands' }));

    const cleared = commandPaletteReducer({ ...leftNested, query: 'x' }, { type: 'back' });
    expect(cleared.query).toBe('');
    expect(commandPaletteReducer(cleared, { type: 'back' })).toBe(initialCommandPaletteState);
  });
});

describe('createCommandPaletteStore', () => {
  it('notifies subscribers only when the state changes', () => {
    const store = createCommandPaletteStore();
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    store.close();
    expect(listener).not.toHaveBeenCalled();
    store.open('commands');
    expect(store.getState()).toMatchObject({ open: true, mode: 'commands' });
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    store.close();
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
