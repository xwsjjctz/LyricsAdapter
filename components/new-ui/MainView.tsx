import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toCoverThumb } from '../../services/coverUrl';
import type { PlaylistEntry } from './types';
import PlaylistCard from './PlaylistCard';

interface MainViewProps {
  entries: PlaylistEntry[];
  onOpenPlaylist: (entry: PlaylistEntry) => void | Promise<void>;
  onPlaylistContextMenu: (entry: PlaylistEntry, event: React.MouseEvent) => void;
}

type CardCssVars = React.CSSProperties & Record<`--card-${string}`, string | number>;
type AmbientCssVars = React.CSSProperties & Record<`--ambient-${string}`, string | number>;

interface CardLayout {
  id: PlaylistEntry['id'];
  x: number;
  y: number;
  rotate: number;
  scale: number;
}

const clamp = (value: number, min: number, max: number): number => Math.min(Math.max(value, min), max);
const dragHandleSelector = '.new-ux-playlist-card';

const MainView: React.FC<MainViewProps> = ({
  entries,
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

  const cardLayouts = useMemo<CardLayout[]>(() => {
    const centerIndex = (entries.length - 1) / 2;
    const spread = entries.length <= 2 ? 260 : 225;

    return entries.map((entry, index) => ({
      id: entry.id,
      x: (index - centerIndex) * spread,
      y: index % 2 === 0 ? 22 : -34,
      rotate: index % 2 === 0 ? -6 : 5,
      scale: entries.length <= 2 ? 1.1 : 1,
    }));
  }, [entries]);

  const ambientCards = useMemo(() => {
    const tracks = entries
      .flatMap(entry => entry.tracks)
      .filter(track => track.coverUrl)
      .slice(0, 24);
    const positions = [
      [-520, -188, -13, 0.82, 0.42, 0.8],
      [-315, -248, 8, 0.68, 0.28, 1.8],
      [395, -236, 12, 0.78, 0.36, 1.2],
      [585, -74, -10, 0.62, 0.26, 2.2],
      [-600, 128, 9, 0.7, 0.3, 1.9],
      [460, 148, -7, 0.82, 0.38, 1.1],
      [-145, -278, -4, 0.6, 0.24, 2.5],
      [118, 232, 11, 0.66, 0.27, 2.1],
      [275, 18, 5, 0.56, 0.22, 2.7],
      [-250, 178, -12, 0.6, 0.24, 2.6],
      [-700, 0, 9, 0.58, 0.23, 2.8],
      [700, -245, 14, 0.58, 0.22, 2.9],
      [-70, 70, -9, 0.52, 0.2, 3.1],
      [690, 238, 7, 0.6, 0.23, 2.5],
      [-420, 260, 12, 0.6, 0.24, 2.4],
      [34, -118, -5, 0.5, 0.18, 3.2],
      [540, 38, 8, 0.54, 0.2, 2.9],
      [-540, -275, -8, 0.54, 0.2, 2.9],
      [-760, 250, 6, 0.5, 0.18, 3.3],
      [780, 88, -11, 0.5, 0.18, 3.3],
      [-330, -36, 5, 0.52, 0.2, 3],
      [348, 300, -8, 0.52, 0.19, 3.1],
      [160, -318, 10, 0.5, 0.18, 3.4],
      [-118, 318, -10, 0.5, 0.18, 3.4],
    ] as const;

    return tracks.map((track, index) => {
      const [x, y, rotate, scale, opacity, blur] = positions[index % positions.length]!;
      const style: AmbientCssVars = {
        '--ambient-x': `${x}px`,
        '--ambient-y': `${y}px`,
        '--ambient-rotate': `${rotate}deg`,
        '--ambient-scale': scale,
        '--ambient-opacity': opacity,
        '--ambient-blur': `${blur}px`,
      };

      return {
        coverUrl: track.coverUrl!,
        title: track.title,
        artist: track.artist,
        style,
      };
    });
  }, [entries]);

  useEffect(() => {
    layoutRef.current = cardLayouts;
  }, [cardLayouts]);

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

        const maxX = Math.max(280, rect.width * 0.32);
        const maxY = Math.max(150, rect.height * 0.22);
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

    animationFrame = window.requestAnimationFrame(animate);
    return () => window.cancelAnimationFrame(animationFrame);
  }, []);

  const registerCard = useCallback((id: PlaylistEntry['id']) => (node: HTMLButtonElement | null) => {
    cardRefs.current[id] = node;
  }, []);

  const handleOpenPlaylist = useCallback((entry: PlaylistEntry) => {
    if (performance.now() < clickGuardUntilRef.current) return;
    dragRef.current.active = false;
    isPanelOpeningRef.current = true;
    setIsDragging(false);
    Promise.resolve(onOpenPlaylist(entry)).finally(() => {
      isPanelOpeningRef.current = false;
    });
  }, [onOpenPlaylist]);

  const handlePointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    if (!(event.target instanceof Element) || !event.target.closest(dragHandleSelector)) return;

    dragRef.current = {
      active: true,
      pointerId: event.pointerId,
      lastX: event.clientX,
      lastY: event.clientY,
      moved: 0,
    };
    motionRef.current.velocityX = 0;
    motionRef.current.velocityY = 0;
  }, []);

  const handlePointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (isPanelOpeningRef.current) return;
    if (!drag.active || drag.pointerId !== event.pointerId) return;

    const dx = event.clientX - drag.lastX;
    const dy = event.clientY - drag.lastY;
    drag.lastX = event.clientX;
    drag.lastY = event.clientY;
    drag.moved += Math.abs(dx) + Math.abs(dy);

    if (drag.moved > 6 && !isDragging) {
      setIsDragging(true);
      event.currentTarget.setPointerCapture(event.pointerId);
    }

    const motion = motionRef.current;
    motion.targetX += dx;
    motion.targetY += dy;
    motion.velocityX = dx * 0.62;
    motion.velocityY = dy * 0.62;
  }, [isDragging]);

  const finishDrag = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag.active || drag.pointerId !== event.pointerId) {
      isPanelOpeningRef.current = false;
      setIsDragging(false);
      return;
    }

    if (drag.moved > 8) {
      clickGuardUntilRef.current = performance.now() + 180;
    }

    dragRef.current.active = false;
    isPanelOpeningRef.current = false;
    setIsDragging(false);

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }, []);

  const handleWheel = useCallback((event: React.WheelEvent<HTMLDivElement>) => {
    if (event.target instanceof Element && event.target.closest('.new-ux-playlist-panel')) return;
    motionRef.current.targetX -= event.deltaX * 0.72;
    motionRef.current.targetY -= (Math.abs(event.deltaY) > Math.abs(event.deltaX) ? event.deltaY : 0) * 0.72;
  }, []);

  const handleDoubleClick = useCallback(() => {
    motionRef.current.targetX = 0;
    motionRef.current.targetY = 0;
    motionRef.current.velocityX = 0;
    motionRef.current.velocityY = 0;
  }, []);

  const cardStyle: CardCssVars = {
    '--card-x': '0px',
    '--card-y': '0px',
    '--card-z': '0px',
    '--card-rotate': '0deg',
    '--card-rot-x': '0deg',
    '--card-rot-y': '0deg',
    '--card-scale': 1,
    '--card-opacity': 1,
    '--card-blur': '0px',
  };

  return (
    <section className="new-ux-mainview new-ux-scrollbar" onWheel={handleWheel}>
      <div className="new-ux-ambient-card-field" aria-hidden="true">
        {ambientCards.map(({ coverUrl, title, artist, style }, index) => (
          <div className="new-ux-ambient-card" key={`${coverUrl}-${index}`} style={style}>
            <div className="new-ux-ambient-card__cover">
              <img src={toCoverThumb(coverUrl, 256)} alt="" />
            </div>
            <div className="new-ux-ambient-card__body">
              <div className="new-ux-ambient-card__title">{title}</div>
              <div className="new-ux-ambient-card__artist">{artist}</div>
              <div className="new-ux-ambient-card__controls">
                <span className="material-symbols-outlined">skip_previous</span>
                <span className="material-symbols-outlined new-ux-ambient-card__play">play_arrow</span>
                <span className="material-symbols-outlined">skip_next</span>
              </div>
            </div>
          </div>
        ))}
      </div>
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
