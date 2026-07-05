import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CardEntry } from './types';
import PlaylistCard from './PlaylistCard';

interface MainViewProps {
  entries: CardEntry[];
  isPlaylistPanelOpen: boolean;
  onOpenPlaylist: (entry: CardEntry) => void | Promise<void>;
  onPlaylistContextMenu: (entry: CardEntry, event: React.MouseEvent) => void;
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
const gridColumnGap = 196;
const gridRowGap = 252;

const MainView: React.FC<MainViewProps> = ({
  entries,
  isPlaylistPanelOpen,
  onOpenPlaylist,
  onPlaylistContextMenu,
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
  const isPlaylistPanelOpenRef = useRef(isPlaylistPanelOpen);
  const clickGuardUntilRef = useRef(0);
  const [isDragging, setIsDragging] = useState(false);
  const [panelCloseEpoch, setPanelCloseEpoch] = useState(0);

  useEffect(() => {
    const wasOpen = wasPlaylistPanelOpenRef.current;
    isPlaylistPanelOpenRef.current = isPlaylistPanelOpen;
    wasPlaylistPanelOpenRef.current = isPlaylistPanelOpen;

    if (wasOpen && !isPlaylistPanelOpen) {
      setPanelCloseEpoch(epoch => epoch + 1);
    }
  }, [isPlaylistPanelOpen]);

  const resetDragState = useCallback((pointerId?: number, guardClick = false) => {
    const drag = dragRef.current;
    const releasePointerId = pointerId ?? drag.pointerId;
    const space = spaceRef.current;

    if (guardClick && drag.moved > 8) {
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
        const maxX = Math.max(280, rect.width * 0.32, layoutBounds.maxX - rect.width * 0.28);
        const maxY = Math.max(150, rect.height * 0.22, layoutBounds.maxY - rect.height * 0.24);
        motion.targetX = clamp(motion.targetX, -maxX, maxX);
        motion.targetY = clamp(motion.targetY, -maxY, maxY);
        motion.x += (motion.targetX - motion.x) * 0.15;
        motion.y += (motion.targetY - motion.y) * 0.15;

        const radius = Math.max(260, Math.min(rect.width, rect.height) * 0.62);

        layoutRef.current.forEach((layout, index) => {
          const node = cardRefs.current[layout.id];
          if (!node) return;

          const x = layout.x + motion.x;
          const y = layout.y + motion.y;
          const distance = Math.hypot(x, y);
          const focus = Math.exp(-Math.pow(distance / radius, 2));
          const scale = layout.scale * (0.68 + focus * 0.40);
          const z = -220 + focus * 380;
          const rotX = clamp((y / radius) * -24, -20, 20);
          const rotY = clamp((x / radius) * 26, -24, 24);
          const opacity = 0.42 + Math.exp(-Math.pow(distance / (radius * 1.6), 2)) * 0.58;
          const blur = (1 - focus) * 3.6;

          node.style.setProperty('--card-z', `${z}px`);
          node.style.setProperty('--card-rot-x', `${rotX}deg`);
          node.style.setProperty('--card-rot-y', `${rotY}deg`);
          node.style.setProperty('--card-scale', `${scale}`);
          node.style.setProperty('--card-opacity', `${opacity}`);
          node.style.setProperty('--card-blur', `${blur}px`);
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
      if (isPlaylistPanelOpenRef.current || isPanelOpeningRef.current) {
        resetDragState(event.pointerId, true);
        return;
      }
      if (!drag.active || drag.pointerId !== event.pointerId) return;

      const dx = event.clientX - drag.lastX;
      const dy = event.clientY - drag.lastY;
      drag.lastX = event.clientX;
      drag.lastY = event.clientY;
      drag.moved += Math.abs(dx) + Math.abs(dy);

      if (drag.moved > 6) {
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
      cardRefs.current[id] = node;
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
    if (isPlaylistPanelOpenRef.current || isPanelOpeningRef.current) return;
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
    if (dragRef.current.active && dragRef.current.pointerId === event.pointerId && dragRef.current.moved > 6) {
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
    if (isPlaylistPanelOpen) return;

    motionRef.current.targetX -= event.deltaX * 0.72;
    motionRef.current.targetY -= (Math.abs(event.deltaY) > Math.abs(event.deltaX) ? event.deltaY : 0) * 0.72;
  }, [isPlaylistPanelOpen]);

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
      <div
        ref={spaceRef}
        className={`new-ux-playlist-space${isDragging ? ' new-ux-playlist-space--dragging' : ''}`}
        onDoubleClick={handleDoubleClick}
      >
        {entries.map(entry => (
          <PlaylistCard
            key={`${entry.id}:${panelCloseEpoch}`}
            entry={entry}
            cardRef={registerCard(entry.id)}
            {...(cardStyles[entry.id] ? { style: cardStyles[entry.id] } : {})}
            onOpen={handleOpenPlaylist}
            onContextMenu={onPlaylistContextMenu}
          />
        ))}
      </div>
    </section>
  );
};

export default MainView;
