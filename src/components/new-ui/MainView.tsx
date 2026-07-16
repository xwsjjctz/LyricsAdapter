import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CardEntry } from './types';
import PlaylistCard from './PlaylistCard';
import SquareCropModal from './SquareCropModal';
import { toCoverThumb } from '../../services/coverUrl';
import { useTranslation } from 'react-i18next';
import type { CardOverride, CardOverrideMap } from '../../services/newUxCardEdit';

interface MainViewProps {
  entries: CardEntry[];
  isPlaylistPanelOpen: boolean;
  /** Pause the full-wall rAF when FocusMode or the app window is inactive. */
  isActive?: boolean;
  onOpenPlaylist: (entry: CardEntry) => void | Promise<void>;
  onPlaylistContextMenu: (entry: CardEntry, event: React.MouseEvent) => void;
  isCardEditMode?: boolean;
  cardOverrides?: CardOverrideMap;
  onCardOverrideChange?: (entryId: string, patch: Partial<CardOverride>) => void;
  activePanel?: 'hidden' | 'bg' | null;
  exitingPanel?: 'hidden' | 'bg' | null;
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
  isActive = true,
  onOpenPlaylist,
  onPlaylistContextMenu,
  isCardEditMode,
  cardOverrides,
  onCardOverrideChange,
  activePanel,
  exitingPanel,
}) => {
  const { t } = useTranslation();
  const spaceRef = useRef<HTMLDivElement | null>(null);
  const cardRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const cardRefCallbacks = useRef<Record<string, CardRefCallback>>({});
  const layoutRef = useRef<CardLayout[]>([]);
  const isPanelOpeningRef = useRef(false);
  const cachedRectRef = useRef<{ width: number; height: number }>({ width: 0, height: 0 });
  const prevZIndexRef = useRef<Record<string, number>>({});
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
  const wakeAnimationRef = useRef<() => void>(() => {});
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

  // Split entries into visible (on the wall) and hidden (in the tray)
  const { visibleEntries, hiddenEntries } = useMemo(() => {
    const vis: CardEntry[] = [];
    const hid: CardEntry[] = [];
    for (const entry of entries) {
      if (cardOverrides?.[entry.id]?.hidden) {
        hid.push(entry);
      } else {
        vis.push(entry);
      }
    }
    return { visibleEntries: vis, hiddenEntries: hid };
  }, [entries, cardOverrides]);

  const cardLayouts = useMemo<CardLayout[]>(() => {
    const list = visibleEntries;
    const columns = list.length <= 3 ? Math.max(list.length, 1) : Math.min(4, list.length);
    const rows = Math.ceil(list.length / columns);
    const yOffset = rows <= 2 ? ((rows - 1) * gridRowGap) / 2 : gridRowGap * 0.62;

    return list.map((entry, index) => {
      const row = Math.floor(index / columns);
      const column = index % columns;
      const rowColumns = Math.min(columns, list.length - row * columns);
      const rowOffset = row % 2 === 0 ? 0 : gridColumnGap * 0.18;

      return {
        id: entry.id,
        x: (column - (rowColumns - 1) / 2) * gridColumnGap + rowOffset,
        y: row * gridRowGap - yOffset,
        rotate: Math.round(Math.sin(index * 2.4 + 0.7) * 7 + Math.cos(index * 1.1) * 2),
        scale: list.length <= 2 ? 1.1 : 1,
      };
    });
  }, [visibleEntries]);

  useEffect(() => {
    layoutRef.current = cardLayouts;
    wakeAnimationRef.current();
  }, [cardLayouts]);

  // Cache the space element's dimensions via ResizeObserver so the rAF loop
  // never calls getBoundingClientRect (which forces synchronous layout).
  useEffect(() => {
    const el = spaceRef.current;
    if (!el) return;
    const ro = new ResizeObserver(entries => {
      for (const entry of entries) {
        cachedRectRef.current = {
          width: entry.contentRect.width,
          height: entry.contentRect.height,
        };
        wakeAnimationRef.current();
      }
    });
    ro.observe(el);
    // Seed initial value
    const rect = el.getBoundingClientRect();
    cachedRectRef.current = { width: rect.width, height: rect.height };
    return () => ro.disconnect();
  }, []);

  // The animation loop is the single writer of wall motion and per-card focus
  // accents. Wall motion is applied by the parent space itself, so a temporarily
  // stale card ref cannot leave one card pinned after opening or closing a panel.
  useEffect(() => {
    if (!isActive) {
      wakeAnimationRef.current = () => {};
      spaceRef.current?.classList.remove('new-ux-playlist-space--active');
      motionRef.current.velocityX = 0;
      motionRef.current.velocityY = 0;
      return;
    }

    let animationFrame = 0;
    let disposed = false;

    const animate = () => {
      animationFrame = 0;
      if (disposed || document.hidden) return;
      const space = spaceRef.current;
      let needsNextFrame = false;

      if (space) {
        const rect = cachedRectRef.current;
        const motion = motionRef.current;

        if (!dragRef.current.active) {
          motion.targetX += motion.velocityX;
          motion.targetY += motion.velocityY;
          motion.velocityX *= 0.92;
          motion.velocityY *= 0.92;
          if (Math.abs(motion.velocityX) < 0.01) motion.velocityX = 0;
          if (Math.abs(motion.velocityY) < 0.01) motion.velocityY = 0;
          needsNextFrame ||= motion.velocityX !== 0 || motion.velocityY !== 0;
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
        needsNextFrame ||= Math.abs(motion.targetX - motion.x) > 0.05
          || Math.abs(motion.targetY - motion.y) > 0.05;

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
          needsNextFrame ||= Math.abs(hoverTarget - hoverScale) > 0.002;

          const scale = baseScale * hoverScale;
          const z = focus * 220 + (hoverScale > 1.01 ? (hoverScale - 1.0) * 200 : 0);
          const rotX = clamp((y / radius) * -26, -22, 22);
          const rotY = clamp((x / radius) * 28, -26, 26);
          const opacity = 0.35 + Math.exp(-Math.pow(distance / (radius * 1.4), 2)) * 0.65;

          node.style.setProperty('--card-z', `${z}px`);
          node.style.setProperty('--card-rot-x', `${rotX}deg`);
          node.style.setProperty('--card-rot-y', `${rotY}deg`);
          node.style.setProperty('--card-scale', `${scale}`);
          node.style.setProperty('--card-opacity', `${opacity}`);

          // Throttle zIndex: only write when the rounded value actually changes
          const newZ = Math.round(1000 + focus * 100 - index);
          if (prevZIndexRef.current[layout.id] !== newZ) {
            node.style.zIndex = String(newZ);
            prevZIndexRef.current[layout.id] = newZ;
          }
        });

        space.style.setProperty('--wall-x', `${motion.x}px`);
        space.style.setProperty('--wall-y', `${motion.y}px`);
        space.style.setProperty('--field-x', `${motion.x * 0.32}px`);
        space.style.setProperty('--field-y', `${motion.y * 0.24}px`);
      }

      if (needsNextFrame) {
        animationFrame = window.requestAnimationFrame(animate);
      } else {
        space?.classList.remove('new-ux-playlist-space--active');
      }
    };

    const start = () => {
      if (!disposed && !document.hidden && animationFrame === 0) {
        spaceRef.current?.classList.add('new-ux-playlist-space--active');
        animate();
      }
    };
    wakeAnimationRef.current = start;

    const handleVisibilityChange = () => {
      if (document.hidden) {
        if (animationFrame !== 0) {
          window.cancelAnimationFrame(animationFrame);
          animationFrame = 0;
        }
        spaceRef.current?.classList.remove('new-ux-playlist-space--active');
        return;
      }
      start();
    };

    // Run one frame synchronously on mount so cards have correct positions on the
    // very first paint — they no longer fall back to CSS :nth-child defaults (those
    // were a second writer that conflicted with this loop).
    start();
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      disposed = true;
      wakeAnimationRef.current = () => {};
      spaceRef.current?.classList.remove('new-ux-playlist-space--active');
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      if (animationFrame !== 0) window.cancelAnimationFrame(animationFrame);
    };
  }, [isActive]);

  useEffect(() => {
    if (isPlaylistPanelOpen) return;

    resetDragState(undefined, true);
  }, [isPlaylistPanelOpen, resetDragState]);

  // Wall-drag is started from a window-level pointerdown so cards covered by
  // the open playlist panel (a higher z-index sibling) can still initiate the
  // drag from the panel's blank area. Declared before the registration effect
  // below so it can be referenced in that effect's dependency array.
  const handlePointerDown = useCallback((event: PointerEvent) => {
    if (isPanelOpeningRef.current) return;
    if (event.button !== 0) return;

    // Interactive elements inside the panel / focus mode are skipped so genuine
    // clicks/scrolls work; presses on blank/background areas still pan the wall.
    const target = event.target as Element | null;
    if (target?.closest?.('.focus-mode-overlay, button, a, input, textarea, select, [role="button"], .new-ux-track-row')) {
      return;
    }

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
      wakeAnimationRef.current();
    };

    const clearDrag = (event: PointerEvent) => {
      if (dragRef.current.pointerId !== event.pointerId) return;

      resetDragState(event.pointerId, true);
      wakeAnimationRef.current();
    };

    window.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('pointermove', handleWindowPointerMove, { passive: false });
    window.addEventListener('pointerup', clearDrag);
    window.addEventListener('pointercancel', clearDrag);
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('pointermove', handleWindowPointerMove);
      window.removeEventListener('pointerup', clearDrag);
      window.removeEventListener('pointercancel', clearDrag);
    };
  }, [resetDragState, handlePointerDown]);

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
        const enter = () => {
          hoveredIdRef.current = id;
          wakeAnimationRef.current();
        };
        const leave = () => {
          if (hoveredIdRef.current === id) hoveredIdRef.current = null;
          wakeAnimationRef.current();
        };
        (node as any)._hoverEnter = enter;
        (node as any)._hoverLeave = leave;
        node.addEventListener('mouseenter', enter);
        node.addEventListener('mouseleave', leave);
        wakeAnimationRef.current();
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
    wakeAnimationRef.current();
  }, []);

  const handleWheel = useCallback((event: React.WheelEvent<HTMLElement>) => {
    motionRef.current.targetX -= event.deltaX * 0.72;
    motionRef.current.targetY -= (Math.abs(event.deltaY) > Math.abs(event.deltaX) ? event.deltaY : 0) * 0.72;
    wakeAnimationRef.current();
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
  const [cropSource, setCropSource] = useState<File | null>(null);

  const handleCoverFileSelected = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !coverTargetRef.current) return;
    setCropSource(file);
    e.target.value = '';
  }, []);

  const handleCropConfirm = useCallback((croppedDataUrl: string) => {
    if (coverTargetRef.current && onCardOverrideChange) {
      onCardOverrideChange(coverTargetRef.current, { coverUrl: croppedDataUrl });
    }
    coverTargetRef.current = null;
    setCropSource(null);
  }, [onCardOverrideChange]);

  const handleCropCancel = useCallback(() => {
    coverTargetRef.current = null;
    setCropSource(null);
  }, []);

  return (
    <section
      className="new-ux-mainview new-ux-scrollbar"
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
        {visibleEntries.map(entry => {
          const override = cardOverrides?.[entry.id];
          return (
            <PlaylistCard
              key={`${entry.id}:${panelCloseEpoch}`}
              entry={entry}
              cardRef={registerCard(entry.id)}
              {...(cardStyles[entry.id] ? { style: cardStyles[entry.id] } : {})}
              onOpen={handleOpenPlaylist}
              onContextMenu={onPlaylistContextMenu}
              {...(isCardEditMode ? { isCardEditMode: true } : {})}
              {...(override?.coverUrl ? { overrideCover: override.coverUrl } : {})}
              {...(override?.name ? { overrideName: override.name } : {})}
              onToggleHidden={() => onCardOverrideChange?.(entry.id, { hidden: true })}
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

      {/* Hidden cards tray — managed by left panel state machine */}
      {isCardEditMode && hiddenEntries.length > 0 && (activePanel === 'hidden' || exitingPanel === 'hidden') && (
        <div className={`new-ux-hidden-tray${exitingPanel === 'hidden' ? ' new-ux-tray--exiting' : ''}`}>
          <div className="new-ux-hidden-tray__header">
            <span className="material-symbols-outlined" style={{ fontSize: 12 }}>visibility_off</span>
            {t('newui.hiddenCards')} ({hiddenEntries.length})
          </div>
          <div className="new-ux-hidden-tray__list">
            {hiddenEntries.map(entry => {
              const override = cardOverrides?.[entry.id];
              const coverUrl = override?.coverUrl ?? (entry.coverUrls[0] || undefined);
              const displayName = override?.name ?? entry.title;
              return (
                <div key={entry.id} className="new-ux-hidden-tray__item">
                  <div className="new-ux-hidden-tray__cover">
                    {coverUrl ? (
                      <img
                        src={toCoverThumb(coverUrl, 128)}
                        alt=""
                        loading="lazy"
                        decoding="async"
                      />
                    ) : (
                      <div className="new-ux-hidden-tray__cover-fallback">
                        <span className="material-symbols-outlined">music_note</span>
                      </div>
                    )}
                  </div>
                  <div className="new-ux-hidden-tray__info">
                    <div className="new-ux-hidden-tray__title">{displayName}</div>
                  </div>
                  <button
                    className="new-ux-hidden-tray__restore"
                    onClick={() => onCardOverrideChange?.(entry.id, { hidden: false })}
                  >
                    <span className="material-symbols-outlined" style={{ fontSize: 14 }}>visibility</span>
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Square crop modal for cover images */}
      {cropSource && (
        <SquareCropModal
          source={cropSource}
          onConfirm={handleCropConfirm}
          onCancel={handleCropCancel}
        />
      )}
    </section>
  );
};

export default React.memo(MainView);
