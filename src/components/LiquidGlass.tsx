import { useEffect, useId, useState, type CSSProperties, type RefObject } from 'react';
import '../styles/liquidGlass.css';

type Material = 'regular' | 'clear';
interface Geometry { width: number; height: number; padding: number; map: string }

/** A rounded-rectangle normal field: the interior stays neutral, only the rim refracts. */
function displacementMap(width: number, height: number, radius: number, padding: number): string | null {
  const canvas = document.createElement('canvas');
  canvas.width = width + padding * 2;
  canvas.height = height + padding * 2;
  const context = canvas.getContext('2d');
  if (!context) return null;
  const pixels = context.createImageData(canvas.width, canvas.height);
  const rim = Math.min(12, radius);
  for (let y = 0; y < canvas.height; y++) {
    for (let x = 0; x < canvas.width; x++) {
      const px = x - padding + .5 - width / 2;
      const py = y - padding + .5 - height / 2;
      const qx = Math.abs(px) - (width / 2 - radius);
      const qy = Math.abs(py) - (height / 2 - radius);
      const ox = Math.max(qx, 0), oy = Math.max(qy, 0);
      const length = Math.hypot(ox, oy);
      const distance = length + Math.min(Math.max(qx, qy), 0) - radius;
      // Fade on both sides of the silhouette; padded pixels remain neutral.
      const amount = Math.max(0, 1 - Math.abs(distance) / rim);
      const nx = length > 0 ? ox / length : qx > qy ? 1 : 0;
      const ny = length > 0 ? oy / length : qx > qy ? 0 : 1;
      const offset = (y * canvas.width + x) * 4;
      pixels.data[offset] = Math.round(127.5 + Math.sign(px) * nx * amount * 112);
      pixels.data[offset + 1] = Math.round(127.5 + Math.sign(py) * ny * amount * 112);
      pixels.data[offset + 2] = 128;
      pixels.data[offset + 3] = 255;
    }
  }
  context.putImageData(pixels, 0, 0);
  const map = canvas.toDataURL();
  canvas.width = 0; canvas.height = 0;
  return map;
}

/** Chromium samples the live backdrop. This map is rebuilt only when geometry changes. */
export function useLiquidGlass(ref: RefObject<HTMLElement>, enabled: boolean, material: Material, radius: number) {
  const id = `glass-${useId().replace(/:/g, '')}`;
  const [geometry, setGeometry] = useState<Geometry | null>(null);
  const blur = material === 'regular' ? 16 : 4;
  useEffect(() => {
    const element = ref.current;
    if (!enabled || !element || typeof ResizeObserver === 'undefined') return;
    // Unsupported engines keep the CSS blur. A parsed URL alone is not a support test;
    // this path is enabled only for the Electron/Chromium Windows renderer.
    if (!CSS.supports('backdrop-filter', `url("#${id}")`)) return;
    let frame = 0, lastWidth = 0, lastHeight = 0;
    const update = () => {
      frame = 0;
      const width = Math.round(element.offsetWidth), height = Math.round(element.offsetHeight);
      if (!width || !height || (width === lastWidth && height === lastHeight)) return;
      lastWidth = width; lastHeight = height;
      const padding = Math.ceil(blur * 3 + 16);
      const map = displacementMap(width, height, Math.min(radius, width / 2, height / 2), padding);
      if (map) setGeometry({ width, height, padding, map });
    };
    const observer = new ResizeObserver(() => { if (!frame) frame = requestAnimationFrame(update); });
    observer.observe(element, { box: 'border-box' });
    update();
    return () => { observer.disconnect(); cancelAnimationFrame(frame); };
  }, [ref, enabled, material, radius, blur, id]);

  const active = enabled && geometry;
  return {
    style: (active ? { '--liquid-glass-filter': `url("#${id}")` } : {}) as CSSProperties,
    filter: active ? (
      <svg className="liquid-glass-definitions" aria-hidden="true" focusable="false" width="0" height="0">
        <defs>
          <filter id={id} filterUnits="userSpaceOnUse" primitiveUnits="userSpaceOnUse"
            x={-geometry.padding} y={-geometry.padding}
            width={geometry.width + geometry.padding * 2} height={geometry.height + geometry.padding * 2}
            colorInterpolationFilters="sRGB">
            <feGaussianBlur in="SourceGraphic" stdDeviation={blur} result="blurred" />
            <feColorMatrix in="blurred" type="saturate" values="1.35" result="backdrop" />
            <feImage href={geometry.map} x={-geometry.padding} y={-geometry.padding}
              width={geometry.width + geometry.padding * 2} height={geometry.height + geometry.padding * 2}
              preserveAspectRatio="none" result="rim" />
            <feDisplacementMap in="backdrop" in2="rim" scale={material === 'regular' ? 10 : 18}
              xChannelSelector="R" yChannelSelector="G" />
          </filter>
        </defs>
      </svg>
    ) : null,
  };
}
