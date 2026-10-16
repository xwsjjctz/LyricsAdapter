import { useSyncExternalStore } from 'react';

/**
 * Minimal external store. State lives outside the React tree, so owners can
 * read the latest value synchronously (no refs mirrored at render time) and
 * components subscribe to just the slice they render.
 */
export interface Store<T> {
  getState(): T;
  /** Applies the update immediately; an identical result notifies no one. */
  setState(update: T | ((previous: T) => T)): void;
  subscribe(listener: () => void): () => void;
}

export function createStore<T>(initial: T): Store<T> {
  let state = initial;
  const listeners = new Set<() => void>();
  return {
    getState: () => state,
    setState(update) {
      const next = typeof update === 'function' ? (update as (previous: T) => T)(state) : update;
      if (Object.is(next, state)) return;
      state = next;
      listeners.forEach(listener => listener());
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  };
}

/**
 * Subscribes to one slice. The selector must return a value that is stable
 * while the slice is unchanged (a field or nested object, not a fresh object).
 */
export function useStoreSelector<T, S>(store: Store<T>, selector: (state: T) => S): S {
  return useSyncExternalStore(store.subscribe, () => selector(store.getState()));
}
