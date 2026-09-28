/** One entry of a context menu shown with the system menu API. */
export type NativeContextMenuItem =
  | { kind: 'action'; id: string; label: string }
  | { kind: 'header'; label: string }
  | { kind: 'separator' };

export interface NativeContextMenuRequest {
  items: NativeContextMenuItem[];
  /** Window content coordinates (CSS px), usually the pointer position. */
  x: number;
  y: number;
}
