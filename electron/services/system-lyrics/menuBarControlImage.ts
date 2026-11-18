import { nativeImage, type NativeImage } from 'electron';

const CONTROL_ICON_HEIGHT = 14;
const CONTROL_IMAGE_HEIGHT = 16;
const MAX_CONTROL_IMAGE_WIDTH = 2_048;
const CONTROL_IMAGE_SCALE_FACTORS = [1, 2] as const;

export const MENU_BAR_CONTROL_BUTTON_WIDTH = 40;
export const MENU_BAR_CONTROL_STRIP_WIDTH = MENU_BAR_CONTROL_BUTTON_WIDTH * 3;

const PREVIOUS_SYMBOL = 'backward.end.fill';
const PLAY_SYMBOL = 'play.fill';
const PAUSE_SYMBOL = 'pause.fill';
const NEXT_SYMBOL = 'forward.end.fill';

function normalizedCanvasWidth(value: number): number {
  if (!Number.isFinite(value)) return MENU_BAR_CONTROL_STRIP_WIDTH;
  return Math.min(
    MAX_CONTROL_IMAGE_WIDTH,
    Math.max(MENU_BAR_CONTROL_STRIP_WIDTH, Math.round(value)),
  );
}

function loadSymbol(name: string): NativeImage | null {
  const image = nativeImage.createFromNamedImage(name);
  if (image.isEmpty()) return null;

  const resized = image.resize({ height: CONTROL_ICON_HEIGHT, quality: 'best' });
  return resized.isEmpty() ? null : resized;
}

function copySymbolBitmap(
  target: Buffer,
  targetPixelWidth: number,
  targetPixelHeight: number,
  symbol: NativeImage,
  logicalX: number,
  scaleFactor: number,
): boolean {
  const size = symbol.getSize(scaleFactor);
  const sourcePixelWidth = Math.round(size.width * scaleFactor);
  const sourcePixelHeight = Math.round(size.height * scaleFactor);
  const targetX = Math.round(logicalX * scaleFactor);
  const targetY = Math.round(
    ((CONTROL_IMAGE_HEIGHT - size.height) / 2) * scaleFactor,
  );
  const source = symbol.toBitmap({ scaleFactor });
  const sourceRowBytes = sourcePixelWidth * 4;

  if (
    sourcePixelWidth <= 0
    || sourcePixelHeight <= 0
    || targetX < 0
    || targetY < 0
    || targetX + sourcePixelWidth > targetPixelWidth
    || targetY + sourcePixelHeight > targetPixelHeight
    || source.length !== sourceRowBytes * sourcePixelHeight
  ) {
    return false;
  }

  for (let row = 0; row < sourcePixelHeight; row += 1) {
    const sourceStart = row * sourceRowBytes;
    const targetStart = ((targetY + row) * targetPixelWidth + targetX) * 4;
    source.copy(
      target,
      targetStart,
      sourceStart,
      sourceStart + sourceRowBytes,
    );
  }
  return true;
}

/**
 * Build one Retina-aware macOS template image containing the three native
 * playback SF Symbols. The transparent canvas preserves the lyric item's hover
 * bounds while the visible controls stay grouped in a compact center strip.
 */
export function createMenuBarControlImage(
  isPlaying: boolean,
  requestedCanvasWidth: number,
): NativeImage | null {
  try {
    const symbols = [
      loadSymbol(PREVIOUS_SYMBOL),
      loadSymbol(isPlaying ? PAUSE_SYMBOL : PLAY_SYMBOL),
      loadSymbol(NEXT_SYMBOL),
    ];
    if (symbols.some(symbol => symbol === null)) return null;

    const resolvedSymbols = symbols as NativeImage[];
    const canvasWidth = normalizedCanvasWidth(requestedCanvasWidth);
    const stripLeft = Math.floor(
      (canvasWidth - MENU_BAR_CONTROL_STRIP_WIDTH) / 2,
    );
    const composite = nativeImage.createEmpty();

    for (const scaleFactor of CONTROL_IMAGE_SCALE_FACTORS) {
      const targetPixelWidth = canvasWidth * scaleFactor;
      const targetPixelHeight = CONTROL_IMAGE_HEIGHT * scaleFactor;
      const buffer = Buffer.alloc(targetPixelWidth * targetPixelHeight * 4);

      const copied = resolvedSymbols.every((symbol, index) => {
        const symbolWidth = symbol.getSize().width;
        const logicalX = stripLeft
          + (index * MENU_BAR_CONTROL_BUTTON_WIDTH)
          + ((MENU_BAR_CONTROL_BUTTON_WIDTH - symbolWidth) / 2);
        return copySymbolBitmap(
          buffer,
          targetPixelWidth,
          targetPixelHeight,
          symbol,
          logicalX,
          scaleFactor,
        );
      });
      if (!copied) return null;

      composite.addRepresentation({
        scaleFactor,
        width: targetPixelWidth,
        height: targetPixelHeight,
        buffer,
      });
    }

    if (composite.isEmpty()) return null;
    composite.setTemplateImage(true);
    return composite;
  } catch {
    return null;
  }
}
