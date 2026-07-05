import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CardEntry } from './types';
import PlaylistCard from './PlaylistCard';
import type { CardOverride, CardOverrideMap } from '../../services/newUxCardEdit';

interface MainViewProps {
  entries: CardEntry[];
  isPlaylistPanelOpen: boolean;
  onOpenPlaylist: (entry: CardEntry) => void | Promise<void>;
  onPlaylistContextMenu: (entry: CardEntry, event: React.MouseEvent) => void;
  isCardEditMode?: boolean;
  cardOverrides?: CardOverrideMap;
  onCardOverrideChange?: (entryId: string, patch: Partial<CardOverride>) => void;
}

type CardCssVars = React.CSSProperties & Record<`--card-${string}`, string | number>;

interface CardLayout {
  id: CardEntry['id'];
  x: number;
  y: number;
  rotate: number;
  scale: number;
}

type CardRefCallback = (node: HTMLButtonElement | null) => void;

const clamp = (value: number, min: number, max: number): number => Math.min(Math.max(value, min), max);
const gridColumnGap = 210;
const gridRowGap = 280;

const MainView: React.FC<MainViewProps> = ({
  entries,
  isPlaylistPanelOpen,
  onOpenPlaylist,
  onPlaylistContextMenu,
  isCardEditMode,
  cardOverrides,
  onCardOverrideChange,
}) => {
  const spaceRef = useRef<HTMLDivElement | null>(null);
  const cardRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const cardRefCallbacks = useRef<Record<string, CardRefCallback>>({});
  const layoutRef = useRef<CardLayout[]>([]);
  const isPanelOpeningRef = useRef(false);
  const motionRef = useRef({
    x: 0,
    y: 0,
    targetX: 0,
    targetY: 0,
    velocityX: 0,
    velocityY: 0,
  });
  const dragRef = useRef({
    active: false,
    pointerId: 0,
    lastX: 0,
    lastY: 0,
    moved: 0,
    thresholdExceeded: false,
  });
  const wasPlaylistPanelOpenRef = useRef(isPlaylistPanelOpen);
  const clickGuardUntilRef = useRef(0);
  const hoveredIdRef = useRef<string | null>(null);
  const hoverScaleRef = useRef<Record<string, number>>({});
  const [isDragging, setIsDragging] = useState(false);
  const [panelCloseEpoch, setPanelCloseEpoch] = useState(0);

  useEffect(() => {
    const wasOpen = wasPlaylistPanelOpenRef.current;
    wasPlaylistPanelOpenRef.current = isPlaylistPanelOpen;

    if (wasOpen && !isPlaylistPanelOpen) {
      setPanelCloseEpoch(epoch => epoch + 1);
    }
  }, [isPlaylistPanelOpen]);

  const resetDragState = useCallback((pointerId?: number, guardClick = false) => {
    const drag = dragRef.current;
    const releasePointerId = pointerId ?? drag.pointerId;
    const space = spaceRef.current;

    if (guardClick && drag.moved > 12) {
      clickGuardUntilRef.current = performance.now() + 180;
    }

    if (space && releasePointerId > 0) {
      try {
        if (space.hasPointerCapture(releasePointerId)) {
          space.releasePointerCapture(releasePointerId);
        }
      } catch {
        // The pointer can already be gone when a panel transition interrupts a drag.
      }
    }

    dragRef.current = {
      active: false,
      pointerId: 0,
      lastX: 0,
      lastY: 0,
      moved: 0,
      thresholdExceeded: false,
    };
    isPanelOpeningRef.current = false;
    setIsDragging(false);
  }, []);

  const cardLayouts = useMemo<CardLayout[]>(() => {
    const columns = entries.length <= 3 ? Math.max(entries.length, 1) : Math.min(4, entries.length);
    const rows = Math.ceil(entries.length / columns);
    const yOffset = rows <= 2 ? ((rows - 1) * gridRowGap) / 2 : gridRowGap * 0.62;

    return entries.map((entry, index) => {
      const row = Math.floor(index / columns);
      const column = index % columns;
      const rowColumns = Math.min(columns, entries.length - row * columns);
      const rowOffset = row % 2 === 0 ? 0 : gridColumnGap * 0.18;

      return {
        id: entry.id,
        x: (column - (rowColumns - 1) / 2) * gridColumnGap + rowOffset,
        y: row * gridRowGap - yOffset,
        rotate: Math.round(Math.sin(index * 2.4 + 0.7) * 7 + Math.cos(index * 1.1) * 2),
        scale: entries.length <= 2 ? 1.1 : 1,
      };
    });
  }, [entries]);

  useEffect(() => {
    layoutRef.current = cardLayouts;
  }, [cardLayouts]);

  // The animation loop is the single writer of wall motion and per-card focus
  // accents. Wall motion lives on the parent space, so a temporarily stale card
  // ref cannot leave one card pinned after opening/closing a panel.
  useEffect(() => {
    let animationFrame = 0;

    const animate = () => {
      const space = spaceRef.current;

      if (space) {
        const rect = space.getBoundingClientRect();
        const motion = motionRef.current;

        if (!dragRef.current.active) {
          motion.targetX += motion.velocityX;
          motion.targetY += motion.velocityY;
          motion.velocityX *= 0.92;
          motion.velocityY *= 0.92;
        }

        const layoutBounds = layoutRef.current.reduce(
          (bounds, layout) => ({
            maxX: Math.max(bounds.maxX, Math.abs(layout.x)),
            maxY: Math.max(bounds.maxY, Math.abs(layout.y)),
          }),
          { maxX: 0, maxY: 0 }
        );
        const maxX = Math.max(400, rect.width * 0.65, layoutBounds.maxX + 120);
        const maxY = Math.max(280, rect.height * 0.55, layoutBounds.maxY + 120);
        motion.targetX = clamp(motion.targetX, -maxX, maxX);
        motion.targetY = clamp(motion.targetY, -maxY, maxY);
        motion.x += (motion.targetX - motion.x) * 0.15;
        motion.y += (motion.targetY - motion.y) * 0.15;

        const radius = Math.max(200, Math.min(rect.width, rect.height) * 0.48);

        layoutRef.current.forEach((layout, index) => {
          const node = cardRefs.current[layout.id];
          if (!node) return;

          const x = layout.x + motion.x;
          const y = layout.y + motion.y;
          const distance = Math.hypot(x, y);
          const focus = Math.exp(-Math.pow(distance / radius, 2));
          const baseScale = layout.scale * (0.55 + focus * 0.60);

          // Smooth hover scale interpolation
          const hoverTarget = hoveredIdRef.current === layout.id ? 1.18 : 1.0;
          const prevHoverScale = hoverScaleRef.current[layout.id] ?? 1.0;
          // Faster spring-back (0.18) than grow-in (0.10) for snappy un-hover
          const lerpRate = hoverTarget < prevHoverScale ? 0.18 : 0.10;
          const hoverScale = prevHoverScale + (hoverTarget - prevHoverScale) * lerpRate;
          hoverScaleRef.current[layout.id] = hoverScale;

          const scale = baseScale * hoverScale;
          const z = -260 + focus * 460 + (hoverScale > 1.01 ? (hoverScale - 1.0) * 200 : 0);
          const rotX = clamp((y / radius) * -26, -22, 22);
          const rotY = clamp((x / radius) * 28, -26, 26);
          const opacity = 0.35 + Math.exp(-Math.pow(distance / (radius * 1.4), 2)) * 0.65;

          node.style.setProperty('--card-z', `${z}px`);
          node.style.setProperty('--card-rot-x', `${rotX}deg`);
          node.style.setProperty('--card-rot-y', `${rotY}deg`);
          node.style.setProperty('--card-scale', `${scale}`);
          node.style.setProperty('--card-opacity', `${opacity}`);
          node.style.zIndex = String(Math.round(1000 + focus * 100 - index));
        });

        space.style.setProperty('--wall-x', `${motion.x}px`);
        space.style.setProperty('--wall-y', `${motion.y}px`);
        space.style.setProperty('--field-x', `${motion.x * 0.32}px`);
        space.style.setProperty('--field-y', `${motion.y * 0.24}px`);
      }

      animationFrame = window.requestAnimationFrame(animate);
    };

    // Run one frame synchronously on mount so cards have correct positions on the
    // very first paint — they no longer fall back to CSS :nth-child defaults (those
    // were a second writer that conflicted with this loop).
    animate();
    return () => window.cancelAnimationFrame(animationFrame);
  }, []);

  useEffect(() => {
    if (isPlaylistPanelOpen) return;

    resetDragState(undefined, true);
  }, [isPlaylistPanelOpen, resetDragState]);

  useEffect(() => {
    const handleWindowPointerMove = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (isPanelOpeningRef.current) {
        resetDragState(event.pointerId, true);
        return;
      }
      if (!drag.active || drag.pointerId !== event.pointerId) return;

      const dx = event.clientX - drag.lastX;
      const dy = event.clientY - drag.lastY;
      drag.lastX = event.clientX;
      drag.lastY = event.clientY;
      drag.moved += Math.abs(dx) + Math.abs(dy);

      if (drag.moved > 12) {
        event.preventDefault();
        if (!drag.thresholdExceeded) {
          drag.thresholdExceeded = true;
          setIsDragging(true);
        }
      }

      const motion = motionRef.current;
      motion.targetX += dx;
      motion.targetY += dy;
      motion.velocityX = dx * 0.62;
      motion.velocityY = dy * 0.62;
    };

    const clearDrag = (event: PointerEvent) => {
      if (dragRef.current.pointerId !== event.pointerId) return;

      resetDragState(event.pointerId, true);
    };

    window.addEventListener('pointermove', handleWindowPointerMove, { passive: false });
    window.addEventListener('pointerup', clearDrag);
    window.addEventListener('pointercancel', clearDrag);
    return () => {
      window.removeEventListener('pointermove', handleWindowPointerMove);
      window.removeEventListener('pointerup', clearDrag);
      window.removeEventListener('pointercancel', clearDrag);
    };
  }, [resetDragState]);

  const registerCard = useCallback((id: CardEntry['id']) => {
    cardRefCallbacks.current[id] ??= (node: HTMLButtonElement | null) => {
      const prev = cardRefs.current[id];
      if (prev) {
        const p = prev as any;
        if (p._hoverEnter) prev.removeEventListener('mouseenter', p._hoverEnter);
        if (p._hoverLeave) prev.removeEventListener('mouseleave', p._hoverLeave);
      }
      cardRefs.current[id] = node;
      if (node) {
        const enter = () => { hoveredIdRef.current = id; };
        const leave = () => { if (hoveredIdRef.current === id) hoveredIdRef.current = null; };
        (node as any)._hoverEnter = enter;
        (node as any)._hoverLeave = leave;
        node.addEventListener('mouseenter', enter);
        node.addEventListener('mouseleave', leave);
      }
    };

    return cardRefCallbacks.current[id];
  }, []);

  const handleOpenPlaylist = useCallback((entry: CardEntry) => {
    if (performance.now() < clickGuardUntilRef.current) return;
    resetDragState(undefined, false);
    isPanelOpeningRef.current = true;
    Promise.resolve(onOpenPlaylist(entry)).finally(() => {
      isPanelOpeningRef.current = false;
    });
  }, [onOpenPlaylist, resetDragState]);

  const handlePointerDown = useCallback((event: React.PointerEvent<HTMLElement>) => {
    if (isPanelOpeningRef.current) return;
    if (event.button !== 0) return;

    dragRef.current = {
      active: true,
      pointerId: event.pointerId,
      lastX: event.clientX,
      lastY: event.clientY,
      moved: 0,
      thresholdExceeded: false,
    };
    // Do not capture here: a plain click must still bubble to the card button.
    // Movement is tracked on window so panel transitions cannot strand the drag.
    motionRef.current.velocityX = 0;
    motionRef.current.velocityY = 0;
  }, []);

  const handlePointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (dragRef.current.active && dragRef.current.pointerId === event.pointerId && dragRef.current.moved > 12) {
      event.preventDefault();
    }
  }, []);

  const finishDrag = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag.active || drag.pointerId !== event.pointerId) {
      resetDragState(event.pointerId, false);
      return;
    }

    resetDragState(event.pointerId, true);
  }, [resetDragState]);

  const handleDoubleClick = useCallback(() => {
    motionRef.current.targetX = 0;
    motionRef.current.targetY = 0;
    motionRef.current.velocityX = 0;
    motionRef.current.velocityY = 0;
  }, []);

  const handleWheel = useCallback((event: React.WheelEvent<HTMLElement>) => {
    motionRef.current.targetX -= event.deltaX * 0.72;
    motionRef.current.targetY -= (Math.abs(event.deltaY) > Math.abs(event.deltaX) ? event.deltaY : 0) * 0.72;
  }, []);

  const handleNativeDragStart = useCallback((event: React.DragEvent<HTMLElement>) => {
    event.preventDefault();
  }, []);

  // Layout variables are static per entry. Runtime wall movement is written on
  // the parent space, while the rAF loop only updates visual depth accents here.
  const cardStyles = useMemo<Record<CardEntry['id'], CardCssVars>>(() => {
    return cardLayouts.reduce<Record<CardEntry['id'], CardCssVars>>((styles, layout) => {
      styles[layout.id] = {
        '--card-layout-x': `${layout.x}px`,
        '--card-layout-y': `${layout.y}px`,
        '--card-z': '0px',
        '--card-rotate': `${layout.rotate}deg`,
        '--card-rot-x': '0deg',
        '--card-rot-y': '0deg',
        '--card-scale': layout.scale,
        '--card-opacity': 1,
        '--card-blur': '0px',
      };
      return styles;
    }, {});
  }, [cardLayouts]);

  const coverInputRef = useRef<HTMLInputElement>(null);
  const coverTargetRef = useRef<string | null>(null);

  const handleCoverFileSelected = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !coverTargetRef.current || !onCardOverrideChange) return;
    const reader = new FileReader();
    reader.onload = async () => {
      const dataUrl = reader.result as string;
      onCardOverrideChange(coverTargetRef.current!, { coverUrl: dataUrl });
      coverTargetRef.current = null;
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  }, [onCardOverrideChange]);

  return (
    <section
      className="new-ux-mainview new-ux-scrollbar"
      onPointerDownCapture={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={finishDrag}
      onPointerCancel={finishDrag}
      onDragStartCapture={handleNativeDragStart}
      onWheel={handleWheel}
    >
      <input
        ref={coverInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleCoverFileSelected}
      />
      <div
        ref={spaceRef}
        className={`new-ux-playlist-space${isDragging ? ' new-ux-playlist-space--dragging' : ''}`}
        onDoubleClick={handleDoubleClick}
      >
        {entries.map(entry => {
          const override = cardOverrides?.[entry.id];
          const isHidden = !!override?.hidden;
          return (
            <PlaylistCard
              key={`${entry.id}:${panelCloseEpoch}`}
              entry={entry}
              cardRef={registerCard(entry.id)}
              {...(cardStyles[entry.id] ? { style: cardStyles[entry.id] } : {})}
              onOpen={handleOpenPlaylist}
              onContextMenu={onPlaylistContextMenu}
              {...(isCardEditMode ? { isCardEditMode: true } : {})}
              {...(isHidden ? { isHidden: true } : {})}
              {...(override?.coverUrl ? { overrideCover: override.coverUrl } : {})}
              {...(override?.name ? { overrideName: override.name } : {})}
              onToggleHidden={() => onCardOverrideChange?.(entry.id, { hidden: !isHidden })}
              onChangeCover={() => {
                coverTargetRef.current = entry.id;
                coverInputRef.current?.click();
              }}
              onChangeName={(name) => {
                if (name) {
                  onCardOverrideChange?.(entry.id, { name });
                } else {
                  onCardOverrideChange?.(entry.id, { name: undefined as unknown as string });
                }
              }}
            />
          );
        })}
      </div>
    </section>
  );
};

export default MainView;
