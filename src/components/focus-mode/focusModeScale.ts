import { useEffect, useState } from 'react';

export const FOCUS_MODE_BASE_WIDTH = 1200;
export const FOCUS_MODE_BASE_HEIGHT = 800;
export const FOCUS_MODE_MAX_SCALE = 1.35;

export function calculateFocusModeScale(width: number, height: number): number {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return 1;

  const viewportScale = Math.min(
    width / FOCUS_MODE_BASE_WIDTH,
    height / FOCUS_MODE_BASE_HEIGHT,
  );
  const clampedScale = Math.max(1, Math.min(FOCUS_MODE_MAX_SCALE, viewportScale));
  return Math.round(clampedScale * 1000) / 1000;
}

function readViewportScale(): number {
  if (typeof window === 'undefined') return 1;
  return calculateFocusModeScale(window.innerWidth, window.innerHeight);
}

export function useFocusModeScale(): number {
  const [scale, setScale] = useState(readViewportScale);

  useEffect(() => {
    let resizeFrame: number | null = null;

    const updateScale = () => {
      resizeFrame = null;
      const nextScale = readViewportScale();
      setScale(currentScale => currentScale === nextScale ? currentScale : nextScale);
    };

    const handleResize = () => {
      if (resizeFrame === null) resizeFrame = window.requestAnimationFrame(updateScale);
    };

    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
      if (resizeFrame !== null) window.cancelAnimationFrame(resizeFrame);
    };
  }, []);

  return scale;
}
