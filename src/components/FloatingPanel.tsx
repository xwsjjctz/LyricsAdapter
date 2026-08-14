import React, { useEffect, useRef } from 'react';

interface FloatingPanelProps {
  children: React.ReactNode;
  onClose: () => void;
  className?: string;
}

/**
 * Positions an interactive card above the current legacy page and closes it
 * when the user clicks outside the card or presses Escape.
 */
const FloatingPanel: React.FC<FloatingPanelProps> = ({ children, onClose, className = '' }) => {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      if (!panelRef.current?.contains(event.target as Node)) onClose();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose]);

  return (
    <div ref={panelRef} className={`floating-panel-shell ${className}`}>
      {children}
    </div>
  );
};

export default FloatingPanel;
