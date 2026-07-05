import React, { useEffect, useRef } from 'react';
import gsap from 'gsap';
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
  album: RectSnapshot | null;
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

export function createFocusTransitionSnapshot(
  root: HTMLElement,
  track: Track,
): FocusTransitionSnapshot | null {
  const query = (name: string) =>
    root.querySelector<HTMLElement>(`[data-focus-transition="${name}"]`);
  const cover    = query('cover');
  const title    = query('title');
  const artist   = query('artist');
  const album    = query('album');
  const controls = query('controls');
  const progress = query('progress');

  if (!cover || !title || !artist || !controls || !progress) return null;

  return {
    track,
    panel:    toRect(root.getBoundingClientRect()),
    cover:    toRect(cover.getBoundingClientRect()),
    title:    toRect(title.getBoundingClientRect()),
    artist:   toRect(artist.getBoundingClientRect()),
    album:    album ? toRect(album.getBoundingClientRect()) : null,
    controls: toRect(controls.getBoundingClientRect()),
    progress: toRect(progress.getBoundingClientRect()),
  };
}

/** Where each hero element should land in Focus Mode. Mirrors FocusMode layout. */
function targetRects() {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const coverSize = Math.min(Math.max(vw * 0.24, 220), 320);
  const coverLeft = vw < 900
    ? (vw - coverSize) / 2
    : Math.max(78, vw * 0.18 - coverSize / 2);
  const coverTop  = vh < 720 ? 80 : Math.max(100, vh * 0.18);
  const textTop   = coverTop + coverSize + 24;
  const controlsW = Math.min(520, vw - 40);

  return {
    panel:    { left: 0,                       top: 0,      width: vw,         height: vh          },
    cover:    { left: coverLeft,               top: coverTop, width: coverSize, height: coverSize   },
    title:    { left: coverLeft,               top: textTop,         width: coverSize, height: 36  },
    artist:   { left: coverLeft,               top: textTop + 42,    width: coverSize, height: 22  },
    album:    { left: coverLeft,               top: textTop + 68,    width: coverSize, height: 18  },
    controls: { left: (vw - 160) / 2,          top: vh - 88,         width: 160,       height: 44  },
    progress: { left: (vw - controlsW) / 2,    top: vh - 140,        width: controlsW, height: 20  },
  };
}

const FocusTransitionLayer: React.FC<FocusTransitionLayerProps> = ({
  snapshot,
  onComplete,
}) => {
  const panelRef   = useRef<HTMLDivElement>(null);
  const coverRef   = useRef<HTMLDivElement>(null);
  const titleRef   = useRef<HTMLDivElement>(null);
  const artistRef  = useRef<HTMLDivElement>(null);
  const albumRef   = useRef<HTMLDivElement>(null);
  const rootRef    = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const tgt = targetRects();
    const src = snapshot;
    const ease = 'power3.inOut';
    const dur  = 0.68;

    const ctx = gsap.context(() => {
      const tl = gsap.timeline({ onComplete });

      // ── Background panel expands from mini-player to full-screen ──────────
      tl.fromTo(
        panelRef.current,
        {
          x:            src.panel.left,
          y:            src.panel.top,
          width:        src.panel.width,
          height:       src.panel.height,
          borderRadius: 24,
          opacity:      1,
        },
        {
          x:            tgt.panel.left,
          y:            tgt.panel.top,
          width:        tgt.panel.width,
          height:       tgt.panel.height,
          borderRadius: 0,
          duration:     dur,
          ease,
        },
        0,
      );

      // ── Cover flies from mini-player to focus position ────────────────────
      tl.fromTo(
        coverRef.current,
        {
          x:            src.cover.left,
          y:            src.cover.top,
          width:        src.cover.width,
          height:       src.cover.height,
          borderRadius: 14,
        },
        {
          x:            tgt.cover.left,
          y:            tgt.cover.top,
          width:        tgt.cover.width,
          height:       tgt.cover.height,
          borderRadius: 22,
          duration:     dur,
          ease,
        },
        0.04,  // 40 ms after panel starts
      );

      // ── Title ─────────────────────────────────────────────────────────────
      tl.fromTo(
        titleRef.current,
        { x: src.title.left, y: src.title.top, opacity: 1 },
        { x: tgt.title.left, y: tgt.title.top, opacity: 1, duration: dur * 0.9, ease },
        0.07,
      );

      // ── Artist ────────────────────────────────────────────────────────────
      tl.fromTo(
        artistRef.current,
        { x: src.artist.left, y: src.artist.top, opacity: 1 },
        { x: tgt.artist.left, y: tgt.artist.top, opacity: 1, duration: dur * 0.9, ease },
        0.09,
      );

      // ── Album (optional) ──────────────────────────────────────────────────
      if (snapshot.album && albumRef.current) {
        tl.fromTo(
          albumRef.current,
          { x: src.album!.left, y: src.album!.top, opacity: 1 },
          { x: tgt.album.left,  y: tgt.album.top,  opacity: 1, duration: dur * 0.9, ease },
          0.11,
        );
      }

      // ── Fade out the whole overlay once elements have landed ───────────────
      tl.to(rootRef.current, { opacity: 0, duration: 0.18, ease: 'power1.in' }, dur - 0.08);
    });

    return () => ctx.revert();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const vw = window.innerWidth;
  const vh = window.innerHeight;

  return (
    <div
      ref={rootRef}
      aria-hidden="true"
      style={{
        pointerEvents: 'none',
        position:      'fixed',
        inset:         0,
        zIndex:        160,
        overflow:      'hidden',
      }}
    >
      {/* Expanding background panel */}
      <div
        ref={panelRef}
        style={{
          position:          'fixed',
          left:              0,
          top:               0,
          transformOrigin:   'top left',
          border:            '1px solid rgba(255,255,255,0.12)',
          background:        'rgba(10,14,22,0.9)',
          backdropFilter:    'blur(32px) saturate(150%)',
          WebkitBackdropFilter: 'blur(32px) saturate(150%)',
        }}
      />

      {/* Hero: album cover */}
      <div
        ref={coverRef}
        style={{
          position:        'fixed',
          left:            0,
          top:             0,
          transformOrigin: 'top left',
          overflow:        'hidden',
          background:      'rgba(255,255,255,0.1)',
          display:         'flex',
          alignItems:      'center',
          justifyContent:  'center',
          boxShadow:       '0 24px 72px rgba(0,0,0,0.52)',
        }}
      >
        {snapshot.track.coverUrl ? (
          <img
            src={toCoverThumb(snapshot.track.coverUrl, 512)}
            alt=""
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          />
        ) : (
          <span
            className="material-symbols-outlined"
            style={{ color: '#fff', fontSize: Math.min(vw, vh) * 0.06 }}
          >
            music_note
          </span>
        )}
      </div>

      {/* Hero: title */}
      <div
        ref={titleRef}
        style={{
          position:        'fixed',
          left:            0,
          top:             0,
          transformOrigin: 'top left',
          overflow:        'hidden',
          whiteSpace:      'nowrap',
          textOverflow:    'ellipsis',
          color:           '#fff',
          fontSize:        14,
          fontWeight:      800,
          textShadow:      '0 8px 24px rgba(0,0,0,0.4)',
          display:         'flex',
          alignItems:      'center',
        }}
      >
        {snapshot.track.title}
      </div>

      {/* Hero: artist */}
      <div
        ref={artistRef}
        style={{
          position:        'fixed',
          left:            0,
          top:             0,
          transformOrigin: 'top left',
          overflow:        'hidden',
          whiteSpace:      'nowrap',
          textOverflow:    'ellipsis',
          color:           'rgba(255,255,255,0.72)',
          fontSize:        12,
          fontWeight:      600,
          display:         'flex',
          alignItems:      'center',
        }}
      >
        {snapshot.track.artist}
      </div>

      {/* Hero: album (optional) */}
      {snapshot.album && (
        <div
          ref={albumRef}
          style={{
            position:        'fixed',
            left:            0,
            top:             0,
            transformOrigin: 'top left',
            overflow:        'hidden',
            whiteSpace:      'nowrap',
            textOverflow:    'ellipsis',
            color:           'rgba(255,255,255,0.44)',
            fontSize:        11,
            fontWeight:      600,
            display:         'flex',
            alignItems:      'center',
          }}
        >
          {snapshot.track.album}
        </div>
      )}
    </div>
  );
};

export default FocusTransitionLayer;
