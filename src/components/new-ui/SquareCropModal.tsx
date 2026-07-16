import React, { useState, useRef, useCallback, useEffect } from 'react';

interface SquareCropModalProps {
  /** Source image — File object or data-URL string. */
  source: File | string;
  onConfirm: (croppedDataUrl: string) => void;
  onCancel: () => void;
}

/**
 * Modal that lets the user crop a rectangular image into a square.
 * - Scroll wheel zooms the image in/out.
 * - Drag the crop region to reposition.
 * - Drag the corner handle to resize (stays square).
 */
const SquareCropModal: React.FC<SquareCropModalProps> = ({ source, onConfirm, onCancel }) => {
  const containerRef = useRef<HTMLDivElement>(null);

  // Natural image dimensions
  const [imgW, setImgW] = useState(0);
  const [imgH, setImgH] = useState(0);

  // Crop rect in IMAGE pixel coordinates (always square)
  const [cropX, setCropX] = useState(0);
  const [cropY, setCropY] = useState(0);
  const [cropSize, setCropSize] = useState(0);

  // Base scale: how the image fits inside the container
  const [baseScale, setBaseScale] = useState(1);
  const [offsetX, setOffsetX] = useState(0);
  const [offsetY, setOffsetY] = useState(0);

  // Zoom multiplier (applied on top of baseScale)
  const [zoom, setZoom] = useState(1);

  // Data URL resolved from the source
  const [dataUrl, setDataUrl] = useState<string | null>(null);

  // Drag state
  const dragRef = useRef<{
    type: 'move' | 'resize';
    startX: number;
    startY: number;
    origCropX: number;
    origCropY: number;
    origCropSize: number;
  } | null>(null);
  const exportImageRef = useRef<HTMLImageElement | null>(null);
  const [isExporting, setIsExporting] = useState(false);

  // Effective display scale (base × zoom)
  const scale = baseScale * zoom;

  // ── Resolve source to a data URL ──
  useEffect(() => {
    if (typeof source === 'string') {
      setDataUrl(source);
      return;
    }
    const objectUrl = URL.createObjectURL(source);
    setDataUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [source]);

  useEffect(() => () => {
    const image = exportImageRef.current;
    if (!image) return;
    image.onload = null;
    image.onerror = null;
    image.src = '';
    exportImageRef.current = null;
  }, []);

  // ── Load image and compute initial crop ──
  useEffect(() => {
    if (!dataUrl) return;
    const img = new Image();
    img.onload = () => {
      const w = img.naturalWidth;
      const h = img.naturalHeight;
      setImgW(w);
      setImgH(h);

      // Initial crop: centered square at 60% of the shorter side
      const size = Math.min(w, h) * 0.6;
      setCropSize(size);
      setCropX((w - size) / 2);
      setCropY((h - size) / 2);
    };
    img.src = dataUrl;
    return () => {
      img.onload = null;
      img.onerror = null;
      if (!img.complete) img.src = '';
    };
  }, [dataUrl]);

  // ── Compute base display layout (without zoom) ──
  useEffect(() => {
    const el = containerRef.current;
    if (!el || imgW === 0 || imgH === 0) return;

    const cw = el.clientWidth;
    const ch = el.clientHeight;

    const pad = 40;
    const availW = cw - pad * 2;
    const availH = ch - pad * 2;
    const fit = Math.min(availW / imgW, availH / imgH);
    setBaseScale(fit);
    setOffsetX((cw - imgW * fit) / 2);
    setOffsetY((ch - imgH * fit) / 2);
  }, [imgW, imgH]);

  // ── Wheel handler: zoom image (native listener for non-passive preventDefault) ──
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const factor = e.deltaY < 0 ? 1.08 : 1 / 1.08;
      setZoom(prev => Math.max(0.3, Math.min(8, prev * factor)));
    };

    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  // ── Pointer handlers ──
  const handlePointerDown = useCallback((e: React.PointerEvent, type: 'move' | 'resize') => {
    e.preventDefault();
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = {
      type,
      startX: e.clientX,
      startY: e.clientY,
      origCropX: cropX,
      origCropY: cropY,
      origCropSize: cropSize,
    };
  }, [cropX, cropY, cropSize]);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag) return;

    // Convert screen delta to image pixels (accounting for zoom)
    const dx = (e.clientX - drag.startX) / scale;
    const dy = (e.clientY - drag.startY) / scale;

    if (drag.type === 'move') {
      const newX = Math.max(0, Math.min(imgW - drag.origCropSize, drag.origCropX + dx));
      const newY = Math.max(0, Math.min(imgH - drag.origCropSize, drag.origCropY + dy));
      setCropX(newX);
      setCropY(newY);
    } else {
      // Resize from bottom-right corner (stays square)
      const minSize = 50;
      const maxSize = Math.min(imgW - drag.origCropX, imgH - drag.origCropY);
      const delta = Math.max(dx, dy);
      const newSize = Math.max(minSize, Math.min(maxSize, drag.origCropSize + delta));
      setCropSize(newSize);
    }
  }, [scale, imgW, imgH]);

  const handlePointerUp = useCallback(() => {
    dragRef.current = null;
  }, []);

  // ── Crop & confirm ──
  const handleConfirm = useCallback(() => {
    if (!dataUrl || imgW === 0 || exportImageRef.current) return;
    const canvas = document.createElement('canvas');
    // Cards render at roughly 200px; 512px keeps Retina/hover detail while
    // limiting every persisted decoded cover to about 1 MiB.
    const outputSize = 512;
    canvas.width = outputSize;
    canvas.height = outputSize;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const img = new Image();
    exportImageRef.current = img;
    setIsExporting(true);
    const release = () => {
      img.onload = null;
      img.onerror = null;
      img.src = '';
      if (exportImageRef.current === img) exportImageRef.current = null;
      setIsExporting(false);
      canvas.width = 0;
      canvas.height = 0;
    };
    img.onload = () => {
      ctx.drawImage(
        img,
        Math.round(cropX), Math.round(cropY), Math.round(cropSize), Math.round(cropSize),
        0, 0, outputSize, outputSize,
      );
      const result = canvas.toDataURL('image/jpeg', 0.88);
      release();
      onConfirm(result);
    };
    img.onerror = release;
    img.src = dataUrl;
  }, [dataUrl, cropX, cropY, cropSize, imgW, onConfirm]);

  // ── Display rect (CSS pixels, includes zoom) ──
  const dispImgW = imgW * scale;
  const dispImgH = imgH * scale;
  const dispCropLeft = offsetX + cropX * scale;
  const dispCropTop = offsetY + cropY * scale;
  const dispCropSize = cropSize * scale;

  if (!dataUrl || imgW === 0) {
    return (
      <div className="sq-crop-modal__backdrop" onClick={onCancel}>
        <div className="sq-crop-modal" onClick={e => e.stopPropagation()}>
          <div className="sq-crop-modal__loading">Loading…</div>
        </div>
      </div>
    );
  }

  return (
    <div className="sq-crop-modal__backdrop" onClick={onCancel}>
      <div className="sq-crop-modal" onClick={e => e.stopPropagation()}>
        {/* Canvas area */}
        <div
          ref={containerRef}
          className="sq-crop-modal__canvas"
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
        >
          {/* Full image (dimmed) — zoomed */}
          <img
            src={dataUrl}
            alt=""
            draggable={false}
            style={{
              position: 'absolute',
              left: offsetX,
              top: offsetY,
              width: dispImgW,
              height: dispImgH,
              userSelect: 'none',
              pointerEvents: 'none',
              filter: 'brightness(0.4)',
            }}
          />

          {/* Bright crop region — clips the same zoomed image */}
          <div
            className="sq-crop-modal__crop-region"
            style={{
              position: 'absolute',
              left: dispCropLeft,
              top: dispCropTop,
              width: dispCropSize,
              height: dispCropSize,
            }}
            onPointerDown={e => handlePointerDown(e, 'move')}
          >
            <img
              src={dataUrl}
              alt=""
              draggable={false}
              style={{
                position: 'absolute',
                left: -(cropX * scale),
                top: -(cropY * scale),
                width: dispImgW,
                height: dispImgH,
                userSelect: 'none',
                pointerEvents: 'none',
              }}
            />
            {/* Grid lines */}
            <div className="sq-crop-modal__grid" />
            {/* Corner resize handle */}
            <div
              className="sq-crop-modal__handle"
              onPointerDown={e => handlePointerDown(e, 'resize')}
            />
          </div>

          {/* Zoom indicator */}
          <div className="sq-crop-modal__zoom-label">
            {Math.round(zoom * 100)}%
          </div>
        </div>

        {/* Action bar */}
        <div className="sq-crop-modal__actions">
          <button className="sq-crop-modal__btn sq-crop-modal__btn--cancel" onClick={onCancel}>
            取消
          </button>
          <button
            className="sq-crop-modal__btn sq-crop-modal__btn--confirm"
            onClick={handleConfirm}
            disabled={isExporting}
          >
            确认裁切
          </button>
        </div>
      </div>
    </div>
  );
};

export default SquareCropModal;
