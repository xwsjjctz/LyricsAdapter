import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const NATIVE_PACKAGE = '@lyrics-adapter/windows-taskbar-native';
const NATIVE_API_VERSION = 2;

export interface WindowsTaskbarAttachOptions {
  widthDip: number;
  heightDip: number;
  gapDip: number;
  cornerRadiusDip: number;
}

export interface WindowsTaskbarNativeBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface WindowsTaskbarAttachResult {
  changed: boolean;
  changeReason: string;
  edge: 'top' | 'bottom';
  dpi: number;
  boundsPx: WindowsTaskbarNativeBounds;
  taskbarClass: 'Shell_TrayWnd';
}

/** Narrow native surface: the renderer never receives this object or an HWND. */
export interface WindowsTaskbarNativeBridge {
  getApiVersion(): number;
  attachTaskbarWindow(
    windowHandle: Buffer,
    options: WindowsTaskbarAttachOptions,
  ): WindowsTaskbarAttachResult;
  detachTaskbarWindow(windowHandle: Buffer): boolean;
  setTaskbarWindowVisible(windowHandle: Buffer, visible: boolean): boolean;
}

type NativeModuleLoader = () => unknown;

function hasFunction(
  value: Record<string, unknown>,
  name: string,
): boolean {
  return typeof value[name] === 'function';
}

export function validateWindowsTaskbarNativeBridge(
  candidate: unknown,
): WindowsTaskbarNativeBridge {
  if (
    !candidate
    || typeof candidate !== 'object'
    || !hasFunction(candidate as Record<string, unknown>, 'getApiVersion')
    || !hasFunction(candidate as Record<string, unknown>, 'attachTaskbarWindow')
    || !hasFunction(candidate as Record<string, unknown>, 'detachTaskbarWindow')
    || !hasFunction(candidate as Record<string, unknown>, 'setTaskbarWindowVisible')
  ) {
    throw new TypeError('Windows taskbar native module has an invalid API.');
  }

  const bridge = candidate as WindowsTaskbarNativeBridge;
  const apiVersion = bridge.getApiVersion();
  if (apiVersion !== NATIVE_API_VERSION) {
    throw new Error(
      `Windows taskbar native API version mismatch (expected ${NATIVE_API_VERSION}, got ${apiVersion}).`,
    );
  }
  return bridge;
}

/** Loads the Windows-only optional dependency without touching it on other OSes. */
export function loadWindowsTaskbarNativeBridge(
  platform: NodeJS.Platform = process.platform,
  load: NativeModuleLoader = () => require(NATIVE_PACKAGE),
): WindowsTaskbarNativeBridge | null {
  if (platform !== 'win32') return null;
  return validateWindowsTaskbarNativeBridge(load());
}
