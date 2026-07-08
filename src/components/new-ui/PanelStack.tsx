import React from 'react';

interface PanelStackProps {
  children: React.ReactNode;
}

const PanelStack: React.FC<PanelStackProps> = ({ children }) => {
  return (
    <div className="new-ux-panel-stack">
      {children}
    </div>
  );
};

export default PanelStack;
