import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const NATIVE_PACKAGE = '@lyrics-adapter/macos-statusbar-native';
const NATIVE_API_VERSION = 1;

export const MACOS_STATUS_ITEM_WIDTH = 240;

export type MacosStatusbarAction = 'previous' | 'toggle-play' | 'next';

export interface MacosStatusbarStartOptions {
  width: number;
  controlStripWidth: number;
}

export interface MacosStatusbarUpdate {
  text: string;
  highlightedGraphemes: number;
  isPlaying: boolean;
}

/** Narrow AppKit surface. It owns only drawing and pointer hit testing. */
export interface MacosStatusbarNativeBridge {
  getApiVersion(): number;
  startStatusItem(
    options: MacosStatusbarStartOptions,
    onAction: (action: MacosStatusbarAction) => void,
  ): boolean;
  updateStatusItem(update: MacosStatusbarUpdate): void;
  stopStatusItem(): void;
}

type NativeModuleLoader = () => unknown;

function hasFunction(value: Record<string, unknown>, name: string): boolean {
  return typeof value[name] === 'function';
}

export function validateMacosStatusbarNativeBridge(
  candidate: unknown,
): MacosStatusbarNativeBridge {
  if (
    !candidate
    || typeof candidate !== 'object'
    || !hasFunction(candidate as Record<string, unknown>, 'getApiVersion')
    || !hasFunction(candidate as Record<string, unknown>, 'startStatusItem')
    || !hasFunction(candidate as Record<string, unknown>, 'updateStatusItem')
    || !hasFunction(candidate as Record<string, unknown>, 'stopStatusItem')
  ) {
    throw new TypeError('macOS status bar native module has an invalid API.');
  }

  const bridge = candidate as MacosStatusbarNativeBridge;
  const apiVersion = bridge.getApiVersion();
  if (apiVersion !== NATIVE_API_VERSION) {
    throw new Error(
      `macOS status bar native API version mismatch (expected ${NATIVE_API_VERSION}, got ${apiVersion}).`,
    );
  }
  return bridge;
}

/** Loads the macOS-only optional dependency without touching it on other OSes. */
export function loadMacosStatusbarNativeBridge(
  platform: NodeJS.Platform = process.platform,
  load: NativeModuleLoader = () => require(NATIVE_PACKAGE),
): MacosStatusbarNativeBridge | null {
  if (platform !== 'darwin') return null;
  return validateMacosStatusbarNativeBridge(load());
}
