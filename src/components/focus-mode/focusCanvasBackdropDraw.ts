/**
 * Pure Canvas2D helpers for the classic FocusMode backdrop: geometry and the
 * edge-extended cover draw that keeps a blurred cover opaque at every edge.
 */

/** A decoded cover image, or a baked cross-fade canvas used as its replacement. */
export type BackdropSource = HTMLImageElement | HTMLCanvasElement;

export function isBackdropSourceReady(source: BackdropSource | null): source is BackdropSource {
  if (!source) return false;
  if (source instanceof HTMLCanvasElement) return source.width > 0 && source.height > 0;
  return source.complete && source.naturalWidth > 0;
}

function backdropSourceSize(source: BackdropSource): { width: number; height: number } {
  return source instanceof HTMLCanvasElement
    ? { width: source.width, height: source.height }
    : { width: source.naturalWidth, height: source.naturalHeight };
}

function coverSourceRect(
  source: BackdropSource,
  targetWidth: number,
  targetHeight: number,
): { x: number; y: number; width: number; height: number } {
  const { width: sourceWidth, height: sourceHeight } = backdropSourceSize(source);
  const imageRatio = sourceWidth / sourceHeight;
  const targetRatio = targetWidth / targetHeight;

  if (imageRatio > targetRatio) {
    const height = sourceHeight;
    const width = height * targetRatio;
    return { x: (sourceWidth - width) / 2, y: 0, width, height };
  }

  const width = sourceWidth;
  const height = width / targetRatio;
  return { x: 0, y: (sourceHeight - height) / 2, width, height };
}

export function drawEdgeExtendedCover(
  ctx: CanvasRenderingContext2D,
  source: BackdropSource,
  width: number,
  height: number,
  padding: number,
): void {
  const rect = coverSourceRect(source, width, height);
  const edgeWidth = Math.min(1, rect.width);
  const edgeHeight = Math.min(1, rect.height);
  const rightX = rect.x + rect.width - edgeWidth;
  const bottomY = rect.y + rect.height - edgeHeight;

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, rect.x, rect.y, rect.width, rect.height, padding, padding, width, height);

  // Extend the source's outermost pixels through the filter padding. This is
  // equivalent to an edge-clamped blur and avoids mixing transparent black into
  // the visible viewport without zooming or changing the cover crop.
  ctx.drawImage(source, rect.x, rect.y, rect.width, edgeHeight, padding, 0, width, padding);
  ctx.drawImage(source, rect.x, bottomY, rect.width, edgeHeight, padding, padding + height, width, padding);
  ctx.drawImage(source, rect.x, rect.y, edgeWidth, rect.height, 0, padding, padding, height);
  ctx.drawImage(source, rightX, rect.y, edgeWidth, rect.height, padding + width, padding, padding, height);
  ctx.drawImage(source, rect.x, rect.y, edgeWidth, edgeHeight, 0, 0, padding, padding);
  ctx.drawImage(source, rightX, rect.y, edgeWidth, edgeHeight, padding + width, 0, padding, padding);
  ctx.drawImage(source, rect.x, bottomY, edgeWidth, edgeHeight, 0, padding + height, padding, padding);
  ctx.drawImage(source, rightX, bottomY, edgeWidth, edgeHeight, padding + width, padding + height, padding, padding);
}
