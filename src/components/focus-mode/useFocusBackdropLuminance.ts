import { useEffect, useState } from 'react';
import { getDesktopAPI } from '../../services/desktopAdapter';
import { toCoverThumb } from '../../services/coverUrl';
import { logger } from '../../services/logger';

/**
 * Whether the FocusMode blurred backdrop is light enough to need dark
 * foreground controls: true → dark icons, false → light icons, null → unknown
 * (fall back to the theme). The main process analyzes the cover because the
 * renderer cannot read cover:// pixels back without tainting the canvas.
 */
export function useFocusBackdropLuminance(coverUrl: string | null | undefined): boolean | null {
  const desktop = getDesktopAPI();
  const api = desktop?.platform === 'darwin' ? desktop.ipc?.focusGlass : undefined;
  const source = toCoverThumb(coverUrl ?? undefined, 256) ?? null;
  const [light, setLight] = useState<boolean | null>(null);

  useEffect(() => {
    if (!api) return;
    return api.onBackdropLuminance(luminance => {
      setLight(luminance == null ? null : luminance >= 0.5);
    });
  }, [api]);

  useEffect(() => {
    if (!api) return;
    void api.setBackdrop(source).catch(error => logger.warn('[FocusGlass] Backdrop analysis failed:', error));
  }, [api, source]);

  return light;
}
