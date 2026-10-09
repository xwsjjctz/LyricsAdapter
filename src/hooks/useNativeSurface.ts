import { useEffect, useRef, useState } from 'react';
import { logger } from '../services/logger';
import type { IpcResult } from '../types/typedIpc';

export interface NativeSurfaceApi<State, Action> {
  start: () => Promise<IpcResult<boolean>>;
  update: (state: State) => Promise<IpcResult<void>>;
  stop: () => Promise<IpcResult<void>>;
  onAction: (callback: (action: Action) => void) => () => void;
}

/**
 * Drives one AppKit surface whose state stays in React: pushes a snapshot on
 * change and routes native input back as intents. Returns false (keep the web
 * surface) without an API, before startup completes or after any native failure.
 */
export function useNativeSurface<State, Action>(
  api: NativeSurfaceApi<State, Action> | undefined,
  state: State,
  onAction: (action: Action) => void,
  tag: string,
): boolean {
  const latest = useRef(onAction);
  latest.current = onAction;
  const [active, setActive] = useState(false);

  useEffect(() => {
    if (!api) return;
    let cancelled = false;
    const unsubscribe = api.onAction(action => { if (!cancelled) latest.current(action); });
    void api.start().then(result => {
      if (!cancelled) setActive(result.ok && result.data);
    }).catch(error => logger.warn(`[${tag}] Using web surface:`, error));
    return () => {
      cancelled = true;
      unsubscribe();
      void api.stop().catch(error => logger.warn(`[${tag}] Cleanup failed:`, error));
    };
  }, [api, tag]);

  const serialized = JSON.stringify(state);
  const failed = useRef(false);
  useEffect(() => {
    if (!api || !active || failed.current) return;
    const fallback = (error?: unknown) => {
      if (failed.current) return;
      failed.current = true;
      logger.warn(`[${tag}] Falling back to web surface:`, error);
      setActive(false);
      void api.stop().catch(() => undefined);
    };
    void api.update(JSON.parse(serialized) as State)
      .then(result => { if (!result.ok) fallback(result.error); })
      .catch(fallback);
  }, [active, api, serialized, tag]);

  return active;
}
