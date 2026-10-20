import { createContext, useContext, useEffect, useRef } from 'react';
import type { NativeSettingsAction, NativeSettingsRow } from '@/types/nativeSettings';

export type RowsHandler = (action: NativeSettingsAction) => void;

export interface RowsRegistry {
  set(key: string, rows: NativeSettingsRow[]): void;
  remove(key: string): void;
  handle(key: string, handler: RowsHandler | null): void;
}

export const RowsRegistryContext = createContext<RowsRegistry | null>(null);

/**
 * Publishes the rows of a component that renders nothing, so its hooks keep their own
 * lifetime: a plugin card's QR login polls only while that card is open, as on the web.
 * Actions on control ids under `key` reach `onAction`.
 */
export function useReportedRows(key: string, rows: NativeSettingsRow[], onAction: RowsHandler): void {
  const registry = useContext(RowsRegistryContext);
  const handlerRef = useRef(onAction);
  handlerRef.current = onAction;
  const serialized = JSON.stringify(rows);
  useEffect(() => {
    if (!registry) return;
    registry.handle(key, action => handlerRef.current(action));
    return () => { registry.handle(key, null); registry.remove(key); };
  }, [key, registry]);
  useEffect(() => {
    registry?.set(key, JSON.parse(serialized) as NativeSettingsRow[]);
  }, [key, registry, serialized]);
}

/** The handler whose key is the longest prefix of the action's control id. */
export function findRowsHandler(handlers: ReadonlyMap<string, RowsHandler>, id: string): RowsHandler | undefined {
  let match = '';
  for (const key of handlers.keys()) {
    if ((id === key || id.startsWith(`${key}:`)) && key.length > match.length) match = key;
  }
  return match ? handlers.get(match) : undefined;
}
