import React, { useEffect, useRef } from 'react';
import appIconUrl from '../../app-icon.png';

const BLUR_RADIUS = 80;

const RootCanvasBackdrop: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const context = canvas.getContext('2d');
    if (!context) return;

    const image = new Image();
    let cancelled = false;

    const draw = () => {
      if (cancelled) return;

      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const width = Math.max(1, Math.round(rect.width * dpr));
      const height = Math.max(1, Math.round(rect.height * dpr));

      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }

      context.setTransform(1, 0, 0, 1, 0, 0);
      context.clearRect(0, 0, width, height);
      context.fillStyle = '#070b11';
      context.fillRect(0, 0, width, height);

      const iconSize = Math.max(width, height) * 0.86;
      const x = (width - iconSize) / 2;
      const y = (height - iconSize) / 2;

      context.save();
      context.filter = `blur(${BLUR_RADIUS * dpr}px) saturate(1.34) brightness(0.82)`;
      context.globalAlpha = 0.92;
      context.drawImage(image, x, y, iconSize, iconSize);
      context.restore();
    };

    const resizeObserver = new ResizeObserver(draw);
    resizeObserver.observe(canvas);
    image.onload = draw;
    image.src = appIconUrl;

    return () => {
      cancelled = true;
      resizeObserver.disconnect();
    };
  }, []);

  return <canvas ref={canvasRef} className="new-ux-root-backdrop" aria-hidden="true" />;
};

export default RootCanvasBackdrop;
