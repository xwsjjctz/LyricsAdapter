import React from 'react';

interface FocusBackdropProps {
  hasBackground: boolean;
  isLinux: boolean;
  blurUnderlyingView: boolean;
  canvasRef: React.Ref<HTMLCanvasElement>;
}

const FocusBackdrop: React.FC<FocusBackdropProps> = ({
  hasBackground,
  isLinux,
  blurUnderlyingView,
  canvasRef,
}) => (
  <>
    {blurUnderlyingView && (
      <div
        data-focus-library-backdrop-blur
        className={`fixed inset-0 pointer-events-none backdrop-blur-sm${isLinux ? ' rounded-lg overflow-hidden' : ''}`}
      />
    )}
    {hasBackground && (
      <canvas
        ref={canvasRef}
        style={{
          position: 'absolute',
          top: '-100px',
          left: '-100px',
          width: 'calc(100% + 200px)',
          height: 'calc(100% + 200px)',
        }}
      />
    )}
    <div
      data-focus-backdrop-overlay
      className={`fixed inset-0 pointer-events-none bg-gradient-to-b from-black/30 via-transparent to-black/50${isLinux ? ' rounded-lg overflow-hidden' : ''}`}
    />
  </>
);

export default FocusBackdrop;
