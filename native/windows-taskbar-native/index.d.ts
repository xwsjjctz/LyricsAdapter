/// <reference types="node" />

export interface AttachTaskbarWindowOptions {
  widthDip: number;
  heightDip: number;
  gapDip: number;
  cornerRadiusDip: number;
}

export interface TaskbarWindowBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface AttachTaskbarWindowResult {
  changed: boolean;
  changeReason: string;
  edge: 'top' | 'bottom';
  dpi: number;
  boundsPx: TaskbarWindowBounds;
  taskbarClass: 'Shell_TrayWnd';
}

export function attachTaskbarWindow(
  hwnd: Buffer,
  options: AttachTaskbarWindowOptions,
): AttachTaskbarWindowResult;

export function detachTaskbarWindow(hwnd: Buffer): boolean;

export function setTaskbarWindowVisible(hwnd: Buffer, visible: boolean): boolean;

export function getApiVersion(): number;
