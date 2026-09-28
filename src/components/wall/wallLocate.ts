/**
 * Scroll targets for keeping the playing tile in view, ported from the list
 * view's locate behaviour: a track switch only scrolls when the tile left the
 * visible band, following the direction of travel; an explicit locate centres it.
 */
export interface WallLocateInput {
  tileTop: number;
  tileBottom: number;
  scrollTop: number;
  viewportHeight: number;
  /** Height of the content area; bounds the scroll. */
  contentHeight: number;
  /** Space covered by overlays at the top (title bar) and bottom (control bar). */
  topInset: number;
  bottomInset: number;
}

const clampScroll = (top: number, input: WallLocateInput) =>
  Math.max(0, Math.min(top, Math.max(0, input.contentHeight - input.viewportHeight)));

export function isTileVisible(input: WallLocateInput): boolean {
  const viewTop = input.scrollTop + input.topInset;
  const viewBottom = input.scrollTop + input.viewportHeight - input.bottomInset;
  return input.tileTop >= viewTop && input.tileBottom <= viewBottom;
}

/**
 * After a track switch: null when the tile is already fully visible; moving
 * forward aligns its bottom edge to the view bottom, moving back its top edge.
 */
export function autoLocateScrollTop(input: WallLocateInput, forward: boolean): number | null {
  if (isTileVisible(input)) return null;
  // Taller than the free band: forward alignment would hide its top.
  const freeHeight = input.viewportHeight - input.topInset - input.bottomInset;
  const tileHeight = input.tileBottom - input.tileTop;
  const target = forward && tileHeight <= freeHeight
    ? input.tileBottom - (input.viewportHeight - input.bottomInset)
    : input.tileTop - input.topInset;
  return clampScroll(target, input);
}

/** Explicit "locate now playing": centre the tile in the free band. */
export function centerLocateScrollTop(input: WallLocateInput): number {
  const freeHeight = input.viewportHeight - input.topInset - input.bottomInset;
  const center = (input.tileTop + input.tileBottom) / 2;
  return clampScroll(center - input.topInset - freeHeight / 2, input);
}
