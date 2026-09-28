import { useEffect, useState } from 'react';
import { nativePaletteOwnsKeyboard } from './useNativePalette';

/**
 * Tracks whether the browser/Electron window currently has focus.
 * Returns true on mount (matches the optimistic default the app expects).
 */
export function useWindowFocus(): boolean {
  const [isWindowFocused, setIsWindowFocused] = useState(true);

  useEffect(() => {
    const handleFocus = () => setIsWindowFocused(true);
    const handleBlur = () => { if (!nativePaletteOwnsKeyboard()) setIsWindowFocused(false); };
    window.addEventListener('focus', handleFocus);
    window.addEventListener('blur', handleBlur);
    return () => {
      window.removeEventListener('focus', handleFocus);
      window.removeEventListener('blur', handleBlur);
    };
  }, []);

  return isWindowFocused;
}
