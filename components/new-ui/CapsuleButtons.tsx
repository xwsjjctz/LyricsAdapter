import React, { useState, useRef, useCallback } from 'react';
import type { Track } from '../../types';
import { saveBgImage, saveBgBlur } from '../../services/newUxCardEdit';

interface CapsuleButtonsProps {
  /** Kept for call-site compatibility. */
  track: Track;
  onLocate: () => void;
  isCardEditMode: boolean;
  onToggleCardEditMode: () => void;
  bgImage: string;
  bgBlur: number;
  onBgImageChange: (dataUrl: string) => void;
  onBgBlurChange: (radius: number) => void;
}

const CapsuleButtons: React.FC<CapsuleButtonsProps> = ({
  onLocate,
  isCardEditMode,
  onToggleCardEditMode,
  bgImage,
  bgBlur,
  onBgImageChange,
  onBgBlurChange,
}) => {
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
      <div className="new-ux-capsule-buttons">
        <button
          type="button"
          className="new-ux-capsule-btn"
          onClick={onLocate}
          title="定位当前播放"
          aria-label="Locate now playing"
        >
          <span className="material-symbols-outlined text-[20px]">gps_fixed</span>
        </button>
        <button
          type="button"
          className={`new-ux-capsule-btn${isCardEditMode ? ' new-ux-capsule-btn--active' : ''}`}
          onClick={() => { onToggleCardEditMode(); setShowBgSettings(false); }}
          title="编辑卡片"
          aria-label="Toggle card edit mode"
        >
          <span className="material-symbols-outlined text-[20px]">{isCardEditMode ? 'check' : 'edit'}</span>
        </button>
        <button
          type="button"
          className={`new-ux-capsule-btn${showBgSettings ? ' new-ux-capsule-btn--active' : ''}`}
          onClick={() => setShowBgSettings(v => !v)}
          title="背景设置"
          aria-label="Background settings"
        >
          <span className="material-symbols-outlined text-[20px]">image</span>
        </button>
      </div>

      {showBgSettings && (
        <div className="new-ux-bg-settings">
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

export default CapsuleButtons;
