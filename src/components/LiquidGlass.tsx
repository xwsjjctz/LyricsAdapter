import { useEffect, useId, useState, type CSSProperties, type RefObject } from 'react';
import '../styles/liquidGlass.css';

type Material = 'regular' | 'clear';
interface Geometry { width: number; height: number; padding: number; map: string }

/**
 * frost/rim: backdrop blur inside the glass and at its edge; bezel/depth: width
 * of the refracting edge and how far it pulls the backdrop inward. Liquid Glass
 * frosts its interior, while the rim stays clear enough to show the bend.
 */
const OPTICS = {
  regular: { frost: 12, rim: 2, bezel: 20, depth: 12, saturation: 1.4 },
  clear: { frost: 3, rim: .75, bezel: 22, depth: 18, saturation: 1.25 },
} as const;

/**
 * A convex bezel around a rounded rectangle. R/G pull the backdrop toward the
 * interior, steepest at the silhouette; B is how much of the clear rim shows.
 * Chromium only supplies the element's own footprint (mirrored beyond it), so
 * the lens can only sample inward, as a real convex edge does.
 */
function lensMap(width: number, height: number, radius: number, bezel: number, padding: number): string | null {
  const canvas = document.createElement('canvas');
  canvas.width = width + padding * 2;
  canvas.height = height + padding * 2;
  const context = canvas.getContext('2d');
  if (!context) return null;
  const pixels = context.createImageData(canvas.width, canvas.height);
  for (let y = 0; y < canvas.height; y++) {
    for (let x = 0; x < canvas.width; x++) {
      const px = x - padding + .5 - width / 2;
      const py = y - padding + .5 - height / 2;
      const qx = Math.abs(px) - (width / 2 - radius);
      const qy = Math.abs(py) - (height / 2 - radius);
      const ox = Math.max(qx, 0), oy = Math.max(qy, 0);
      const length = Math.hypot(ox, oy);
      const inside = radius - length - Math.min(Math.max(qx, qy), 0);
      // Keep the silhouette's antialiased pixels on the lens; padding stays neutral.
      const edge = inside < -2 ? 0 : Math.min(1, Math.max(0, 1 - inside / bezel));
      const shift = edge ** 4 * 127.5;
      const nx = length > 0 ? ox / length : qx > qy ? 1 : 0;
      const ny = length > 0 ? oy / length : qx > qy ? 0 : 1;
      const offset = (y * canvas.width + x) * 4;
      pixels.data[offset] = Math.round(127.5 - Math.sign(px) * nx * shift);
      pixels.data[offset + 1] = Math.round(127.5 - Math.sign(py) * ny * shift);
      pixels.data[offset + 2] = Math.round(edge ** 3 * 255);
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
  const optics = OPTICS[material];
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
      // The frost needs mirrored backdrop beyond the silhouette to blur into.
      const padding = Math.ceil(optics.frost * 3);
      const corner = Math.min(radius, width / 2, height / 2);
      const map = lensMap(width, height, corner, Math.min(optics.bezel, corner), padding);
      if (map) setGeometry({ width, height, padding, map });
    };
    const observer = new ResizeObserver(() => { if (!frame) frame = requestAnimationFrame(update); });
    observer.observe(element, { box: 'border-box' });
    update();
    return () => { observer.disconnect(); cancelAnimationFrame(frame); };
  }, [ref, enabled, optics, radius, id]);

  const active = enabled && geometry;
  const region = active ? {
    x: -geometry.padding, y: -geometry.padding,
    width: geometry.width + geometry.padding * 2, height: geometry.height + geometry.padding * 2,
  } : null;
  return {
    style: (active ? { '--liquid-glass-filter': `url("#${id}")` } : {}) as CSSProperties,
    filter: active && region ? (
      <svg className="liquid-glass-definitions" aria-hidden="true" focusable="false" width="0" height="0">
        <defs>
          <filter id={id} filterUnits="userSpaceOnUse" primitiveUnits="userSpaceOnUse" {...region} colorInterpolationFilters="sRGB">
            <feColorMatrix in="SourceGraphic" type="saturate" values={String(optics.saturation)} result="backdrop" />
            <feGaussianBlur in="backdrop" stdDeviation={optics.frost} result="frost" />
            <feGaussianBlur in="backdrop" stdDeviation={optics.rim} result="clear" />
            <feImage href={geometry.map} {...region} preserveAspectRatio="none" result="lens" />
            <feDisplacementMap in="frost" in2="lens" scale={optics.depth * 2} xChannelSelector="R" yChannelSelector="G" result="body" />
            <feDisplacementMap in="clear" in2="lens" scale={optics.depth * 2} xChannelSelector="R" yChannelSelector="G" result="edge" />
            {/* The map's blue channel becomes the mask that reveals the clear rim. */}
            <feColorMatrix in="lens" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 1 0 0" result="rim" />
            <feComposite in="edge" in2="rim" operator="in" result="bend" />
            <feMerge><feMergeNode in="body" /><feMergeNode in="bend" /></feMerge>
          </filter>
        </defs>
      </svg>
    ) : null,
  };
}
