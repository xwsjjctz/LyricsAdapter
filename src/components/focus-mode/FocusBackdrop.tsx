import React from 'react';
import FocusAmllBackdrop from './FocusAmllBackdrop';
import FocusCanvasBackdrop from './FocusCanvasBackdrop';

interface FocusBackdropProps {
  /** AMLL's flowing mesh gradient instead of the classic blurred cover. */
  amllBackground: boolean;
  trackId: string | undefined;
  coverUrl: string | undefined;
  isVisible: boolean;
  isPlaying: boolean;
  isLinux: boolean;
  /** The background opacity setting. */
  opacity: number;
  /** Blur radius of the classic backdrop. */
  blurRadius: number;
}

/** The FocusMode backdrop in the selected mode, under a shared readability gradient. */
const FocusBackdrop: React.FC<FocusBackdropProps> = ({
  amllBackground,
  trackId,
  coverUrl,
  isVisible,
  isPlaying,
  isLinux,
  opacity,
  blurRadius,
}) => (
  <>
    {amllBackground ? (
      <FocusAmllBackdrop coverUrl={coverUrl} isVisible={isVisible} isPlaying={isPlaying} opacity={opacity} />
    ) : (
      <FocusCanvasBackdrop
        trackId={trackId}
        coverUrl={coverUrl}
        isVisible={isVisible}
        isLinux={isLinux}
        opacity={opacity}
        blurRadius={blurRadius}
      />
    )}
    <div
      data-focus-backdrop-overlay
      className={`fixed inset-0 pointer-events-none bg-gradient-to-b from-black/30 via-transparent to-black/50${isLinux ? ' rounded-lg overflow-hidden' : ''}`}
    />
  </>
);

export default FocusBackdrop;
