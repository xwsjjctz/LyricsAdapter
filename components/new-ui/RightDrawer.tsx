import React, { useState } from 'react';

interface RightDrawerProps {
  isCardEditMode: boolean;
  onToggleCardEditMode: () => void;
  onOpenSettings: () => void;
  onOpenTheme: () => void;
  showBgSettings: boolean;
  onToggleBgSettings: () => void;
}

const RightDrawer: React.FC<RightDrawerProps> = ({
  isCardEditMode,
  onToggleCardEditMode,
  onOpenSettings,
  onOpenTheme,
  showBgSettings,
  onToggleBgSettings,
}) => {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      <button
        className={`new-ux-drawer-handle${isOpen ? ' new-ux-drawer-handle--open' : ''}`}
        onClick={() => setIsOpen(v => !v)}
      >
        <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
          {isOpen ? 'chevron_right' : 'chevron_left'}
        </span>
      </button>

      <div className={`new-ux-drawer${isOpen ? ' new-ux-drawer--open' : ''}`}>
        <div className="new-ux-drawer__content">
          <button className="new-ux-drawer__btn" onClick={onOpenSettings}>
            <span className="material-symbols-outlined">settings</span>
          </button>
          <button className="new-ux-drawer__btn" onClick={onOpenTheme}>
            <span className="material-symbols-outlined">palette</span>
          </button>
          <div className="new-ux-drawer__sep" />
          <button
            className={`new-ux-drawer__btn${isCardEditMode ? ' new-ux-drawer__btn--active' : ''}`}
            onClick={onToggleCardEditMode}
          >
            <span className="material-symbols-outlined">{isCardEditMode ? 'check' : 'edit'}</span>
          </button>
          <button
            className={`new-ux-drawer__btn${showBgSettings ? ' new-ux-drawer__btn--active' : ''}`}
            onClick={onToggleBgSettings}
          >
            <span className="material-symbols-outlined">image</span>
          </button>
        </div>
      </div>
    </>
  );
};

export default RightDrawer;
