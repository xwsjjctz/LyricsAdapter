import React, { useState, useRef, useCallback } from 'react';
import { saveBgImage, saveBgBlur } from '../../services/newUxCardEdit';

interface RightDrawerProps {
  isCardEditMode: boolean;
  onToggleCardEditMode: () => void;
  onOpenSettings: () => void;
  onOpenTheme: () => void;
  bgImage: string;
  bgBlur: number;
  onBgImageChange: (dataUrl: string) => void;
  onBgBlurChange: (radius: number) => void;
}

const RightDrawer: React.FC<RightDrawerProps> = ({
  isCardEditMode,
  onToggleCardEditMode,
  onOpenSettings,
  onOpenTheme,
  bgImage,
  bgBlur,
  onBgImageChange,
  onBgBlurChange,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [showBgSettings, setShowBgSettings] = useState(false);
  const bgInputRef = useRef<HTMLInputElement>(null);

  const handleBgFileSelected = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      const dataUrl = reader.result as string;
      onBgImageChange(dataUrl);
      await saveBgImage(dataUrl);
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  }, [onBgImageChange]);

  const handleClearBg = useCallback(async () => {
    onBgImageChange('');
    await saveBgImage('');
  }, [onBgImageChange]);

  const handleBlurChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = Number(e.target.value);
    onBgBlurChange(val);
    await saveBgBlur(val);
  }, [onBgBlurChange]);

  return (
    <>
      {/* Drawer handle — always visible on the right edge */}
      <button
        className={`new-ux-drawer-handle${isOpen ? ' new-ux-drawer-handle--open' : ''}`}
        onClick={() => setIsOpen(v => !v)}
        title={isOpen ? '收起' : '展开工具栏'}
      >
        <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
          {isOpen ? 'chevron_right' : 'chevron_left'}
        </span>
      </button>

      {/* Drawer body */}
      <div className={`new-ux-drawer${isOpen ? ' new-ux-drawer--open' : ''}`}>
        <div className="new-ux-drawer__content">
          {/* Settings */}
          <button className="new-ux-drawer__btn" onClick={onOpenSettings} title="设置">
            <span className="material-symbols-outlined">settings</span>
            <span className="new-ux-drawer__btn-label">设置</span>
          </button>

          {/* Theme */}
          <button className="new-ux-drawer__btn" onClick={onOpenTheme} title="主题">
            <span className="material-symbols-outlined">palette</span>
            <span className="new-ux-drawer__btn-label">主题</span>
          </button>

          {/* Separator */}
          <div className="new-ux-drawer__sep" />

          {/* Edit mode */}
          <button
            className={`new-ux-drawer__btn${isCardEditMode ? ' new-ux-drawer__btn--active' : ''}`}
            onClick={onToggleCardEditMode}
            title="编辑卡片"
          >
            <span className="material-symbols-outlined">{isCardEditMode ? 'check' : 'edit'}</span>
            <span className="new-ux-drawer__btn-label">{isCardEditMode ? '完成' : '编辑'}</span>
          </button>

          {/* Background */}
          <button
            className={`new-ux-drawer__btn${showBgSettings ? ' new-ux-drawer__btn--active' : ''}`}
            onClick={() => setShowBgSettings(v => !v)}
            title="背景设置"
          >
            <span className="material-symbols-outlined">image</span>
            <span className="new-ux-drawer__btn-label">背景</span>
          </button>
        </div>

        {/* Background settings sub-panel */}
        {showBgSettings && (
          <div className="new-ux-drawer__sub">
            <div className="new-ux-bg-settings__label">背景图片</div>
            <div className="new-ux-bg-settings__row">
              <button
                className="new-ux-edit-overlay__btn"
                onClick={() => bgInputRef.current?.click()}
                title="选择图片"
                style={{ width: 'auto', borderRadius: 8, padding: '4px 10px', fontSize: 11 }}
              >
                <span className="material-symbols-outlined" style={{ fontSize: 14, marginRight: 4 }}>upload</span>
                选择
              </button>
              {bgImage && (
                <button
                  className="new-ux-edit-overlay__btn"
                  onClick={handleClearBg}
                  title="清除背景"
                  style={{ width: 'auto', borderRadius: 8, padding: '4px 10px', fontSize: 11 }}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: 14, marginRight: 4 }}>delete</span>
                  清除
                </button>
              )}
            </div>
            <div className="new-ux-bg-settings__label" style={{ marginTop: 12 }}>模糊半径</div>
            <div className="new-ux-bg-settings__row">
              <input
                type="range"
                min={0}
                max={200}
                value={bgBlur}
                onChange={handleBlurChange}
                className="new-ux-bg-settings__slider"
              />
              <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', minWidth: 32, textAlign: 'right' }}>
                {bgBlur}px
              </span>
            </div>
          </div>
        )}
      </div>

      <input
        ref={bgInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleBgFileSelected}
      />
    </>
  );
};

export default RightDrawer;
