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

const clamp = (value: number, min: number, max: number): number => Math.min(Math.max(value, min), max);
const gridColumnGap = 220;
const gridRowGap = 280;

const MainView: React.FC<MainViewProps> = ({
  entries,
  isPlaylistPanelOpen,
  onOpenPlaylist,
  onPlaylistContextMenu,
}) => {
  const spaceRef = useRef<HTMLDivElement | null>(null);
  const cardRefs = useRef<Record<string, HTMLButtonElement | null>>({});
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
  });
  const clickGuardUntilRef = useRef(0);
  const [isDragging, setIsDragging] = useState(false);

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
        rotate: (column % 2 === 0 ? -5 : 4) + (row % 2 === 0 ? 0 : 2),
        scale: entries.length <= 2 ? 1.1 : 1,
      };
    });
  }, [entries]);

  useEffect(() => {
    layoutRef.current = cardLayouts;
  }, [cardLayouts]);

  // The animation loop is the SINGLE writer of every --card-* CSS variable and
  // each card's zIndex. It runs once on mount with an empty dependency array and
  // never re-creates — all dynamic inputs reach it through refs (spaceRef /
  // layoutRef / cardRefs / motionRef / dragRef), so opening or closing the
  // playlist panel (which re-renders MainView) cannot teardown and restart the
  // loop, and React cannot clobber the values written here.
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

        const radius = Math.max(300, Math.min(rect.width, rect.height) * 0.72);

        layoutRef.current.forEach((layout, index) => {
          const node = cardRefs.current[layout.id];
          if (!node) return;

          const x = layout.x + motion.x;
          const y = layout.y + motion.y;
          const distance = Math.hypot(x, y);
          const focus = Math.exp(-Math.pow(distance / radius, 2));
          const scale = layout.scale * (0.74 + focus * 0.34);
          const z = -180 + focus * 300;
          const rotX = clamp((y / radius) * -22, -18, 18);
          const rotY = clamp((x / radius) * 24, -22, 22);
          const opacity = 0.5 + Math.exp(-Math.pow(distance / (radius * 1.9), 2)) * 0.5;
          const blur = (1 - focus) * 2.8;

          node.style.setProperty('--card-x', `${x}px`);
          node.style.setProperty('--card-y', `${y}px`);
          node.style.setProperty('--card-z', `${z}px`);
          node.style.setProperty('--card-rotate', `${layout.rotate}deg`);
          node.style.setProperty('--card-rot-x', `${rotX}deg`);
          node.style.setProperty('--card-rot-y', `${rotY}deg`);
          node.style.setProperty('--card-scale', `${scale}`);
          node.style.setProperty('--card-opacity', `${opacity}`);
          node.style.setProperty('--card-blur', `${blur}px`);
          node.style.zIndex = String(Math.round(1000 + focus * 100 - index));
        });

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
    const clearDrag = (event: PointerEvent) => {
      if (dragRef.current.pointerId !== event.pointerId) return;

      resetDragState(event.pointerId, true);
    };

    window.addEventListener('pointerup', clearDrag);
    window.addEventListener('pointercancel', clearDrag);
    return () => {
      window.removeEventListener('pointerup', clearDrag);
      window.removeEventListener('pointercancel', clearDrag);
    };
  }, [resetDragState]);

  const registerCard = useCallback((id: CardEntry['id']) => (node: HTMLButtonElement | null) => {
    cardRefs.current[id] = node;
  }, []);

  const handleOpenPlaylist = useCallback((entry: CardEntry) => {
    if (performance.now() < clickGuardUntilRef.current) return;
    resetDragState(undefined, false);
    isPanelOpeningRef.current = true;
    Promise.resolve(onOpenPlaylist(entry)).finally(() => {
      isPanelOpeningRef.current = false;
    });
  }, [onOpenPlaylist, resetDragState]);

  const handlePointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (isPlaylistPanelOpen) return;
    if (event.button !== 0) return;

    dragRef.current = {
      active: true,
      pointerId: event.pointerId,
      lastX: event.clientX,
      lastY: event.clientY,
      moved: 0,
    };
    // NOTE: setPointerCapture is intentionally NOT called here. Capturing on
    // pointerdown retargets the subsequent pointerup (and the browser-synthesised
    // click) to the space div, which steals the click from the card button —
    // panels never open. Capture is acquired in handlePointerMove once the drag
    // threshold is exceeded; that plus draggable={false} on the card is enough to
    // keep dragging responsive.
    motionRef.current.velocityX = 0;
    motionRef.current.velocityY = 0;
  }, [isPlaylistPanelOpen]);

  const handlePointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (isPlaylistPanelOpen || isPanelOpeningRef.current) {
      resetDragState(event.pointerId, true);
      return;
    }
    if (!drag.active || drag.pointerId !== event.pointerId) return;

    const dx = event.clientX - drag.lastX;
    const dy = event.clientY - drag.lastY;
    drag.lastX = event.clientX;
    drag.lastY = event.clientY;
    drag.moved += Math.abs(dx) + Math.abs(dy);

    if (drag.moved > 6 && !isDragging) {
      setIsDragging(true);
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        // Ignore stale pointers; the next global pointerup/cancel will clean up.
      }
    }

    if (drag.moved > 6) {
      event.preventDefault();
    }

    const motion = motionRef.current;
    motion.targetX += dx;
    motion.targetY += dy;
    motion.velocityX = dx * 0.62;
    motion.velocityY = dy * 0.62;
  }, [isDragging, isPlaylistPanelOpen, resetDragState]);

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

  // The rAF loop is the single writer of every --card-* variable. This inline
  // style only registers the custom properties on the node (so they exist before
  // the first frame) — its identity is memoised so React never rewrites it on
  // re-render, leaving the loop's per-frame values untouched.
  const cardStyle = useMemo<CardCssVars>(() => ({
    '--card-x': '0px',
    '--card-y': '0px',
    '--card-z': '0px',
    '--card-rotate': '0deg',
    '--card-rot-x': '0deg',
    '--card-rot-y': '0deg',
    '--card-scale': 1,
    '--card-opacity': 1,
    '--card-blur': '0px',
  }), []);

  return (
    <section className="new-ux-mainview new-ux-scrollbar" onWheel={handleWheel}>
      <div
        ref={spaceRef}
        className={`new-ux-playlist-space${isDragging ? ' new-ux-playlist-space--dragging' : ''}`}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={finishDrag}
        onPointerLeave={finishDrag}
        onPointerCancel={finishDrag}
        onDoubleClick={handleDoubleClick}
      >
        {entries.map(entry => (
          <PlaylistCard
            key={entry.id}
            entry={entry}
            cardRef={registerCard(entry.id)}
            style={cardStyle}
            onOpen={handleOpenPlaylist}
            onContextMenu={onPlaylistContextMenu}
          />
        ))}
      </div>
    </section>
  );
};

export default MainView;
