import React, { useState, useRef, useCallback, useEffect } from 'react';

interface SquareCropModalProps {
  /** Source image — File object or data-URL string. */
  source: File | string;
  onConfirm: (croppedDataUrl: string) => void;
  onCancel: () => void;
}

/**
 * Modal that lets the user crop a rectangular image into a square.
 * The crop region is locked to 1:1. The user can drag to reposition
 * and drag the corner handle to resize.
 */
const SquareCropModal: React.FC<SquareCropModalProps> = ({ source, onConfirm, onCancel }) => {
  const containerRef = useRef<HTMLDivElement>(null);

  // Natural image dimensions
  const [imgW, setImgW] = useState(0);
  const [imgH, setImgH] = useState(0);

  // Crop rect in IMAGE pixel coordinates (always square: cropW === cropH)
  const [cropX, setCropX] = useState(0);
  const [cropY, setCropY] = useState(0);
  const [cropSize, setCropSize] = useState(0);

  // How the image fits inside the container
  const [displayScale, setDisplayScale] = useState(1);
  const [offsetX, setOffsetX] = useState(0);
  const [offsetY, setOffsetY] = useState(0);

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

  // ── Resolve source to a data URL ──
  useEffect(() => {
    if (typeof source === 'string') {
      setDataUrl(source);
    } else {
      const reader = new FileReader();
      reader.onload = () => setDataUrl(reader.result as string);
      reader.readAsDataURL(source);
    }
  }, [source]);

  // ── Load image and compute initial crop ──
  useEffect(() => {
    if (!dataUrl) return;
    const img = new Image();
    img.onload = () => {
      const w = img.naturalWidth;
      const h = img.naturalHeight;
      setImgW(w);
      setImgH(h);

      // Initial crop: centered square, as large as possible
      const size = Math.min(w, h);
      setCropSize(size);
      setCropX((w - size) / 2);
      setCropY((h - size) / 2);
    };
    img.src = dataUrl;
  }, [dataUrl]);

  // ── Compute display layout ──
  useEffect(() => {
    const el = containerRef.current;
    if (!el || imgW === 0 || imgH === 0) return;

    const cw = el.clientWidth;
    const ch = el.clientHeight;

    // Fit image inside container with padding
    const pad = 40;
    const availW = cw - pad * 2;
    const availH = ch - pad * 2;
    const scale = Math.min(availW / imgW, availH / imgH);
    setDisplayScale(scale);
    setOffsetX((cw - imgW * scale) / 2);
    setOffsetY((ch - imgH * scale) / 2);
  }, [imgW, imgH]);

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

    const dx = (e.clientX - drag.startX) / displayScale;
    const dy = (e.clientY - drag.startY) / displayScale;

    if (drag.type === 'move') {
      const newX = Math.max(0, Math.min(imgW - drag.origCropSize, drag.origCropX + dx));
      const newY = Math.max(0, Math.min(imgH - drag.origCropSize, drag.origCropY + dy));
      setCropX(newX);
      setCropY(newY);
    } else {
      // Resize from bottom-right corner
      const minSize = 50;
      const maxSize = Math.min(imgW - drag.origCropX, imgH - drag.origCropY);
      const delta = Math.max(dx, dy); // keep square: use larger axis
      const newSize = Math.max(minSize, Math.min(maxSize, drag.origCropSize + delta));
      setCropSize(newSize);
    }
  }, [displayScale, imgW, imgH]);

  const handlePointerUp = useCallback(() => {
    dragRef.current = null;
  }, []);

  // ── Crop & confirm ──
  const handleConfirm = useCallback(() => {
    if (!dataUrl || imgW === 0) return;
    const canvas = document.createElement('canvas');
    const size = Math.round(cropSize);
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const img = new Image();
    img.onload = () => {
      ctx.drawImage(
        img,
        Math.round(cropX), Math.round(cropY), size, size,
        0, 0, size, size,
      );
      onConfirm(canvas.toDataURL('image/jpeg', 0.92));
    };
    img.src = dataUrl;
  }, [dataUrl, cropX, cropY, cropSize, imgW, onConfirm]);

  // ── Display rect (CSS pixels) ──
  const dispCropLeft = offsetX + cropX * displayScale;
  const dispCropTop = offsetY + cropY * displayScale;
  const dispCropSize = cropSize * displayScale;

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
          {/* Full image (dimmed) */}
          <img
            src={dataUrl}
            alt=""
            draggable={false}
            style={{
              position: 'absolute',
              left: offsetX,
              top: offsetY,
              width: imgW * displayScale,
              height: imgH * displayScale,
              userSelect: 'none',
              pointerEvents: 'none',
              filter: 'brightness(0.45)',
            }}
          />

          {/* Bright crop region */}
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
                left: -(cropX * displayScale),
                top: -(cropY * displayScale),
                width: imgW * displayScale,
                height: imgH * displayScale,
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
        </div>

        {/* Action bar */}
        <div className="sq-crop-modal__actions">
          <button className="sq-crop-modal__btn sq-crop-modal__btn--cancel" onClick={onCancel}>
            取消
          </button>
          <button className="sq-crop-modal__btn sq-crop-modal__btn--confirm" onClick={handleConfirm}>
            确认裁切
          </button>
        </div>
      </div>
    </div>
  );
};

export default SquareCropModal;
