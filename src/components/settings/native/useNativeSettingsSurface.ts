import { useEffect, useRef, useState } from 'react';
import { logger } from '@/services/logger';
import type { TypedElectronIPC } from '@/types/typedIpc';
import type { NativeSettingsAction, NativeSettingsState } from '@/types/nativeSettings';

export type NativeSettingsApi = NonNullable<TypedElectronIPC['nativeSettings']>;
export type NativeSettingsStatus = 'starting' | 'active' | 'failed';

/**
 * Drives the AppKit settings sheet while it is mounted: starts it, pushes each changed
 * snapshot and routes input back. Unlike the always-mounted palette, settings mount when
 * they open, so the result says whether AppKit is still starting; the caller shows the
 * web sheet once this reports `failed`.
 */
export function useNativeSettingsSurface(
  api: NativeSettingsApi | undefined,
  state: NativeSettingsState,
  onAction: (action: NativeSettingsAction) => void,
  /** Runs after AppKit has applied a snapshot. */
  onSynced?: () => void,
): NativeSettingsStatus {
  const latest = useRef(onAction);
  latest.current = onAction;
  const synced = useRef(onSynced);
  synced.current = onSynced;
  const [status, setStatus] = useState<NativeSettingsStatus>(api ? 'starting' : 'failed');

  useEffect(() => {
    if (!api) return;
    let cancelled = false;
    const unsubscribe = api.onAction(action => { if (!cancelled) latest.current(action); });
    void api.start().then(result => {
      if (!cancelled) setStatus(result.ok && result.data ? 'active' : 'failed');
    }).catch(error => {
      logger.warn('[NativeSettings] Using web settings:', error);
      if (!cancelled) setStatus('failed');
    });
    return () => {
      cancelled = true;
      unsubscribe();
      void api.stop().catch(error => logger.warn('[NativeSettings] Cleanup failed:', error));
    };
  }, [api]);

  const serialized = JSON.stringify(state);
  useEffect(() => {
    if (!api || status !== 'active') return;
    const fail = (error?: unknown) => {
      logger.warn('[NativeSettings] Falling back to web settings:', error);
      setStatus('failed');
    };
    void api.update(JSON.parse(serialized) as NativeSettingsState)
      .then(result => { if (result.ok) synced.current?.(); else fail(result.error); })
      .catch(fail);
  }, [api, serialized, status]);

  return status;
}
