import React from 'react';

interface FocusBackdropProps {
  hasBackground: boolean;
  bgBlurRadius: number;
  isLinux: boolean;
  canvasRef: React.Ref<HTMLCanvasElement>;
  ambientLayer: React.ReactNode;
}

const FocusBackdrop: React.FC<FocusBackdropProps> = ({
  hasBackground,
  bgBlurRadius,
  isLinux,
  canvasRef,
  ambientLayer,
}) => (
  <>
    {hasBackground && (
      <canvas
        ref={canvasRef}
        style={{
          position: 'absolute',
          top: '-100px',
          left: '-100px',
          width: 'calc(100% + 200px)',
          height: 'calc(100% + 200px)',
          filter: `blur(${bgBlurRadius}px) saturate(1.5) brightness(0.55)`,
          transition: 'filter 700ms ease-in-out',
        }}
      />
    )}
    {ambientLayer}
    <div className={`fixed inset-0 bg-gradient-to-b from-black/30 via-transparent to-black/50 backdrop-blur-sm${isLinux ? ' rounded-lg overflow-hidden' : ''}`} />
  </>
);

export default FocusBackdrop;
