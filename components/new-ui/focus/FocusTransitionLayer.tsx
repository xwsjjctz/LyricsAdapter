import React from 'react';
import { toCoverThumb } from '../../../services/coverUrl';
import type { Track } from '../../../types';

interface RectSnapshot {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface FocusTransitionSnapshot {
  track: Track;
  panel: RectSnapshot;
  cover: RectSnapshot;
  title: RectSnapshot;
  artist: RectSnapshot;
  controls: RectSnapshot;
  progress: RectSnapshot;
}

interface FocusTransitionLayerProps {
  snapshot: FocusTransitionSnapshot;
  onComplete: () => void;
}

function toRect(rect: DOMRect): RectSnapshot {
  return {
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height,
  };
}

export function createFocusTransitionSnapshot(root: HTMLElement, track: Track): FocusTransitionSnapshot | null {
  const query = (name: string) => root.querySelector<HTMLElement>(`[data-focus-transition="${name}"]`);
  const cover = query('cover');
  const title = query('title');
  const artist = query('artist');
  const controls = query('controls');
  const progress = query('progress');

  if (!cover || !title || !artist || !controls || !progress) return null;

  return {
    track,
    panel: toRect(root.getBoundingClientRect()),
    cover: toRect(cover.getBoundingClientRect()),
    title: toRect(title.getBoundingClientRect()),
    artist: toRect(artist.getBoundingClientRect()),
    controls: toRect(controls.getBoundingClientRect()),
    progress: toRect(progress.getBoundingClientRect()),
  };
}

function targetRects() {
  const width = window.innerWidth;
  const height = window.innerHeight;
  const coverSize = Math.min(Math.max(width * 0.24, 260), 340);
  const coverLeft = width < 900 ? (width - coverSize) / 2 : Math.max(78, width * 0.2 - coverSize / 2);
  const coverTop = height < 760 ? 96 : Math.max(118, height * 0.2);
  const textTop = coverTop + coverSize + 28;
  const controlsWidth = Math.min(560, width - 40);

  return {
    panel: { left: 0, top: 0, width, height },
    cover: { left: coverLeft, top: coverTop, width: coverSize, height: coverSize },
    title: { left: coverLeft, top: textTop, width: coverSize, height: 38 },
    artist: { left: coverLeft, top: textTop + 44, width: coverSize, height: 24 },
    controls: { left: (width - 176) / 2, top: height - 96, width: 176, height: 48 },
    progress: { left: (width - controlsWidth) / 2, top: height - 148, width: controlsWidth, height: 24 },
  };
}

function transitionStyle(source: RectSnapshot, target: RectSnapshot): React.CSSProperties {
  return {
    left: source.left,
    top: source.top,
    width: source.width,
    height: source.height,
    '--focus-dx': `${target.left - source.left}px`,
    '--focus-dy': `${target.top - source.top}px`,
    '--focus-sx': target.width / Math.max(source.width, 1),
    '--focus-sy': target.height / Math.max(source.height, 1),
  } as React.CSSProperties;
}

const FocusTransitionLayer: React.FC<FocusTransitionLayerProps> = ({ snapshot, onComplete }) => {
  const targets = targetRects();

  return (
    <div className="new-ux-focus-transition" onAnimationEnd={onComplete} aria-hidden="true">
      <div className="new-ux-focus-transition__panel" style={transitionStyle(snapshot.panel, targets.panel)} />
      <div className="new-ux-focus-transition__cover" style={transitionStyle(snapshot.cover, targets.cover)}>
        {snapshot.track.coverUrl ? (
          <img src={toCoverThumb(snapshot.track.coverUrl, 512)} alt="" />
        ) : (
          <span className="material-symbols-outlined">music_note</span>
        )}
      </div>
      <div className="new-ux-focus-transition__title" style={transitionStyle(snapshot.title, targets.title)}>
        {snapshot.track.title}
      </div>
      <div className="new-ux-focus-transition__artist" style={transitionStyle(snapshot.artist, targets.artist)}>
        {snapshot.track.artist} · {snapshot.track.album}
      </div>
      <div className="new-ux-focus-transition__progress" style={transitionStyle(snapshot.progress, targets.progress)} />
      <div className="new-ux-focus-transition__controls" style={transitionStyle(snapshot.controls, targets.controls)} />
    </div>
  );
};

export default FocusTransitionLayer;
