import { useSyncExternalStore } from 'react';
import { isWindowVisible, subscribeWindowVisibility } from '../services/windowVisibility';

/** False while the main window is minimized or hidden; continuous animations should stop. */
export function useWindowVisible(): boolean {
  return useSyncExternalStore(subscribeWindowVisibility, isWindowVisible);
}
