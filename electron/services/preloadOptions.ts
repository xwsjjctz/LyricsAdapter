import os from 'node:os';
import { OS_RELEASE_ARGUMENT } from '../../src/shared/preloadArguments';

/**
 * Sandboxed preload settings shared by every window. The preload has no Node
 * access, so values it needs from Node arrive as process arguments.
 */
export function sandboxedPreloadPreferences(preload: string): Pick<Electron.WebPreferences,
  'preload' | 'sandbox' | 'contextIsolation' | 'nodeIntegration' | 'additionalArguments'> {
  return {
    preload,
    sandbox: true,
    contextIsolation: true,
    nodeIntegration: false,
    additionalArguments: [`${OS_RELEASE_ARGUMENT}${os.release()}`],
  };
}
