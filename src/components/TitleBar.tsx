import React, { memo, useState, useEffect } from 'react';
import { useWindowControls } from '../hooks/useWindowControls';
import { nativePaletteOwnsKeyboard } from '../hooks/useNativePalette';
import { getDesktopAPI } from '../services/desktopAdapter';
import { useTranslation } from 'react-i18next';
import { getMacTitleBarLayout } from '../shared/macTitleBarLayout';

// 窗口控制按钮图标组件
const MinimizeIcon = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
    <rect x="1" y="5.5" width="10" height="1" rx="0.5" />
  </svg>
);

const MaximizeIcon = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2">
    <rect x="1.5" y="1.5" width="9" height="9" rx="1" />
  </svg>
);

const RestoreIcon = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2">
    <rect x="2.5" y="4.5" width="7" height="6" rx="1" />
    <path d="M4 4.5V3.5C4 2.94772 4.44772 2.5 5 2.5H9C9.55228 2.5 10 2.94772 10 3.5V7.5" />
  </svg>
);

const CloseIcon = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2">
    <path d="M2.5 2.5L9.5 9.5M9.5 2.5L2.5 9.5" strokeLinecap="round" />
  </svg>
);

const CollapseIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
    <path d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6 1.41-1.41z" />
  </svg>
);

// macOS 27 traffic lights (sampled from the native red/yellow/green lights at
// 2x) have a ~1px pale, hue-tinted specular rim along both the top and the
// bottom edge, a saturated center band and a lifted lower half. Only the icon
// rotates so the lighting stays anchored to the dot.
const GLOSSY_RIM = 'rgba(196, 222, 255, 0.9)';
const GLOSSY_RIM_FALLOFF = 'rgba(196, 222, 255, 0.45)';

const GLOSSY_FOCUSED_LIGHT: React.CSSProperties = {
  backgroundColor: '#3b82f6',
  backgroundImage: 'linear-gradient(180deg, #5d98f8 0%, #3b82f6 32%, #3b82f6 48%, #5a95f6 64%, #6299f5 100%)',
  boxShadow: [
    `inset 0 0.5px 0 ${GLOSSY_RIM}`,
    `inset 0 1px 0 ${GLOSSY_RIM_FALLOFF}`,
    `inset 0 -0.5px 0 ${GLOSSY_RIM}`,
    `inset 0 -1px 0 ${GLOSSY_RIM_FALLOFF}`,
  ].join(', '),
};

// Unfocused native lights are translucent glass: a near-opaque neutral gray
// rim (it does not pick up the backdrop hue) at top and bottom that tapers
// along the sides, and a fill that is brighter in the upper third.
const UNFOCUSED_RIM = 'rgba(186, 184, 184, 0.95)';
const UNFOCUSED_RIM_FALLOFF = 'rgba(186, 184, 184, 0.45)';

const GLOSSY_UNFOCUSED_LIGHT: React.CSSProperties = {
  backgroundColor: 'rgba(255, 255, 255, 0.16)',
  backgroundImage: 'linear-gradient(180deg, rgba(255, 255, 255, 0.05) 0%, rgba(255, 255, 255, 0.05) 30%, rgba(255, 255, 255, 0) 70%)',
  boxShadow: [
    `inset 0 0.5px 0 ${UNFOCUSED_RIM}`,
    `inset 0 1px 0 ${UNFOCUSED_RIM_FALLOFF}`,
    `inset 0 -0.5px 0 ${UNFOCUSED_RIM}`,
    `inset 0 -1px 0 ${UNFOCUSED_RIM_FALLOFF}`,
  ].join(', '),
};

function getFocusLightStyle(isWindowFocused: boolean, glossy: boolean): React.CSSProperties {
  if (glossy) return isWindowFocused ? GLOSSY_FOCUSED_LIGHT : GLOSSY_UNFOCUSED_LIGHT;
  return { backgroundColor: isWindowFocused ? '#3b82f6' : 'rgba(255, 255, 255, 0.15)' };
}

interface TitleBarProps {
  isFocusMode?: boolean;
  onToggleFocusMode?: () => void;
}

const TitleBar: React.FC<TitleBarProps> = memo(({ isFocusMode, onToggleFocusMode }) => {
  const { canControl, minimize, maximize, close, isMaximized, isFullScreen } = useWindowControls();

  const { t } = useTranslation();

  // Window focus state (for focus button styling)
  const [isWindowFocused, setIsWindowFocused] = useState(true);
  useEffect(() => {
    const handleFocus = () => setIsWindowFocused(true);
    const handleBlur = () => { if (!nativePaletteOwnsKeyboard()) setIsWindowFocused(false); };
    window.addEventListener('focus', handleFocus);
    window.addEventListener('blur', handleBlur);
    return () => {
      window.removeEventListener('focus', handleFocus);
      window.removeEventListener('blur', handleBlur);
    };
  }, []);

  // Mouse hover state for the button
  const [isButtonHovered, setIsButtonHovered] = useState(false);

  // 检测平台
  const desktopAPI = getDesktopAPI();
  const platform = desktopAPI?.platform || '';
  const isMacOS = platform === 'darwin';
  const isLinux = platform === 'linux';

  // 如果不在桌面环境，不显示标题栏
  if (!canControl) {
    return null;
  }

  if (isMacOS) {
    const layout = getMacTitleBarLayout(desktopAPI?.osRelease);
    return (
      <div
        className="fixed top-0 left-0 right-0 bg-transparent select-none z-[160] flex items-start"
        style={{
          height: layout.height,
          WebkitAppRegion: 'drag',
          WebkitUserSelect: 'none',
          userSelect: 'none'
        } as React.CSSProperties}
      >
        <div className="h-full shrink-0" style={{ width: layout.dotLeft - 5 }} />
        <div className="h-full flex items-center" style={{ WebkitAppRegion: 'no-drag', visibility: isFullScreen ? 'hidden' : 'visible' } as React.CSSProperties}>
          <button
            onClick={onToggleFocusMode}
            data-no-gsap-bounce
            className="h-full flex items-center justify-center pl-[5px] pr-0.5"
            aria-label={isFocusMode ? t('titleBar.exitFocusMode') : t('titleBar.enterFocusMode')}
            onMouseEnter={() => setIsButtonHovered(true)}
            onMouseLeave={() => setIsButtonHovered(false)}
          >
            <div
              className="rounded-full flex items-center justify-center"
              style={{
                width: layout.dotSize,
                height: layout.dotSize,
                ...getFocusLightStyle(isWindowFocused, layout.glossy),
              }}
            >
              {isWindowFocused && isButtonHovered && (
                <span
                  className="material-symbols-outlined"
                  style={{
                    color: layout.glossy ? 'rgba(0, 32, 96, 0.75)' : 'black',
                    fontSize: 12,
                    transform: isFocusMode ? 'rotate(0deg)' : 'rotate(180deg)',
                    transition: 'transform 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
                  }}
                >
                  expand_more
                </span>
              )}
            </div>
          </button>
        </div>
        <div className="flex-1" />
      </div>
    );
  }

  // Windows / Linux 渲染自定义标题栏和窗口控制按钮
  return (
      <div
        className={`fixed top-0 left-0 right-0 h-9 bg-transparent select-none z-[160] flex items-start${isLinux ? ' rounded-lg overflow-hidden' : ''}`}
        style={{
          WebkitAppRegion: 'drag',
          WebkitUserSelect: 'none',
          userSelect: 'none'
        } as React.CSSProperties}
      >
        {/* 左侧拖动空间 */}
        <div className="flex-1 h-full" />

        {/* 右侧窗口控制按钮 */}
        <div
          className="flex items-center h-full ml-auto"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          <button
            onClick={onToggleFocusMode}
            data-no-gsap-bounce
            className="titlebar-btn"
            aria-label={isFocusMode ? t('titleBar.exitFocusMode') : t('titleBar.enterFocusMode')}
          >
            <span className="transition-transform duration-250 ease-out" style={{ transform: isFocusMode ? 'rotate(0deg)' : 'rotate(180deg)', transition: 'transform 0.25s cubic-bezier(0.4, 0, 0.2, 1)' }}>
              <CollapseIcon />
            </span>
          </button>
          <button
            onClick={minimize}
            data-no-gsap-bounce
            className="titlebar-btn"
            aria-label={t('titleBar.minimize')}
          >
            <MinimizeIcon />
          </button>
          <button
            onClick={maximize}
            data-no-gsap-bounce
            className="titlebar-btn"
            aria-label={isMaximized ? t('titleBar.restore') : t('titleBar.maximize')}
          >
            {isMaximized ? <RestoreIcon /> : <MaximizeIcon />}
          </button>
          <button
            onClick={close}
            data-no-gsap-bounce
            className="titlebar-btn titlebar-btn--close"
            aria-label={t('titleBar.close')}
          >
            <CloseIcon />
          </button>
        </div>
      </div>
    );
});

TitleBar.displayName = 'TitleBar';

export default TitleBar;
