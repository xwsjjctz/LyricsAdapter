import React, { memo, useState, useEffect, useRef } from 'react';
import { useWindowControls } from '../hooks/useWindowControls';
import { getDesktopAPI } from '../services/desktopAdapter';
import { i18n } from '../services/i18n';
import { themeManager } from '../services/themeManager';
import { ThemeConfig } from '../types/theme';

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

interface TitleBarProps {
  isFocusMode?: boolean;
  onToggleFocusMode?: () => void;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  onSearchFocus: () => void;
  onSearchBlur: () => void;
}

const TitleBar: React.FC<TitleBarProps> = memo(({ isFocusMode, onToggleFocusMode, searchQuery, onSearchChange, onSearchFocus, onSearchBlur }) => {
  const searchInputRef = useRef<HTMLInputElement>(null);
  const { canControl, minimize, maximize, close, isMaximized } = useWindowControls();

  // Force re-render when language changes
  const [, setLanguageVersion] = useState(0);
  const [currentTheme, setCurrentTheme] = useState<ThemeConfig>(themeManager.getCurrentTheme());

  // Window focus state
  const [isWindowFocused, setIsWindowFocused] = useState(true);

  // Mouse hover state for the button
  const [isButtonHovered, setIsButtonHovered] = useState(false);

  // Track window focus
  useEffect(() => {
    const handleFocus = () => setIsWindowFocused(true);
    const handleBlur = () => setIsWindowFocused(false);

    window.addEventListener('focus', handleFocus);
    window.addEventListener('blur', handleBlur);

    return () => {
      window.removeEventListener('focus', handleFocus);
      window.removeEventListener('blur', handleBlur);
    };
  }, []);

  useEffect(() => {
    const unsubscribe = i18n.subscribe(() => {
      setLanguageVersion(v => v + 1);
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    const unsubscribe = themeManager.subscribe(() => {
      setCurrentTheme(themeManager.getCurrentTheme());
    });
    return unsubscribe;
  }, []);

  const colors = currentTheme.colors;

  // 检测平台
  const desktopAPI = getDesktopAPI();
  const platform = desktopAPI?.platform || '';
  const isMacOS = platform === 'darwin';

  // 如果不在桌面环境，不显示标题栏
  if (!canControl) {
    return null;
  }

  // macOS Electron 使用系统原生标题栏，显示透明标题栏区域
  const notchRadius = 10;
  const searchBox = (
    <div
      className="absolute left-1/2 -translate-x-1/2 flex items-end justify-center"
      style={{
        WebkitAppRegion: 'no-drag',
        top: 0,
        width: '420px',
        maxWidth: 'calc(100vw - 200px)',
        height: `${32 + notchRadius}px`,
        paddingBottom: '0px',
        // Inward curves at top corners (notch effect)
        WebkitMaskImage: `
          radial-gradient(circle ${notchRadius}px at ${notchRadius}px ${notchRadius}px, transparent ${notchRadius}px, black ${notchRadius}px),
          radial-gradient(circle ${notchRadius}px at calc(100% - ${notchRadius}px) ${notchRadius}px, transparent ${notchRadius}px, black ${notchRadius}px)
        `,
        WebkitMaskComposite: 'source-in',
        maskComposite: 'intersect',
        borderRadius: `0 0 14px 14px`,
        overflow: 'hidden',
      } as React.CSSProperties}
    >
      <div
        className="relative w-full flex items-center"
        style={{
          height: '32px',
          backgroundColor: isWindowFocused ? `${colors.backgroundCard}e0` : `${colors.backgroundCard}90`,
          backdropFilter: 'blur(16px)',
          borderBottom: `1px solid ${colors.borderLight}`,
        }}
      >
        <span
          className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-sm pointer-events-none"
          style={{ color: colors.textMuted }}
        >
          search
        </span>
        <input
          ref={searchInputRef}
          type="text"
          placeholder={i18n.t('search.typeToSearch')}
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          onFocus={onSearchFocus}
          onBlur={onSearchBlur}
          className="w-full h-full pl-8 pr-3 text-sm bg-transparent transition-all focus:outline-none"
          style={{ color: colors.textPrimary }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              onSearchChange('');
              searchInputRef.current?.blur();
            }
          }}
        />
      </div>
    </div>
  );

  if (isMacOS) {
    return (
      <div
        className="fixed top-0 left-0 right-0 h-9.5 bg-transparent select-none z-[100] flex items-center"
        style={{
          WebkitAppRegion: 'drag',
          WebkitUserSelect: 'none',
          userSelect: 'none'
        } as React.CSSProperties}
      >
        <div className="w-[55px] h-full" />
        <div className="flex items-center justify-center" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          <button
            onClick={onToggleFocusMode}
            className="w-12 h-12 flex items-center justify-center"
            aria-label={isFocusMode ? i18n.t('titleBar.exitFocusMode') : i18n.t('titleBar.enterFocusMode')}
            onMouseEnter={() => setIsButtonHovered(true)}
            onMouseLeave={() => setIsButtonHovered(false)}
          >
            <div
              className="w-[12.4px] h-[12.4px] rounded-full flex items-center justify-center transition-all"
              style={{
                backgroundColor: isWindowFocused ? '#3b82f6' : 'rgba(255, 255, 255, 0.15)',
                transform: isFocusMode ? 'rotate(0deg)' : 'rotate(180deg)',
                transition: 'transform 0.25s cubic-bezier(0.4, 0, 0.2, 1), background-color 0.00s ease-in-out'
              }}
            >
              {isWindowFocused && isButtonHovered && (
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="black"
                  style={{
                    transition: 'opacity 0.15s ease-in-out',
                    opacity: 1
                  }}
                >
                  <path d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6 1.41-1.41z" />
                </svg>
              )}
            </div>
          </button>
        </div>
        {searchBox}
      </div>
    );
  }

  // Windows / Linux 渲染自定义标题栏和窗口控制按钮
  return (
      <div
        className="fixed top-0 left-0 right-0 h-9 bg-transparent select-none z-[100] flex items-center"
        style={{
          WebkitAppRegion: 'drag',
          WebkitUserSelect: 'none',
          userSelect: 'none'
        } as React.CSSProperties}
      >
        {/* 左侧拖动 + 搜索框 */}
        <div className="flex-1 h-full flex items-center justify-center">
          {searchBox}
        </div>

        {/* 右侧窗口控制按钮 */}
        <div
          className="flex items-center h-full"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          <button
            onClick={onToggleFocusMode}
            className="w-[46px] h-full flex items-center justify-center transition-colors"
            style={{ color: colors.textSecondary }}
            onMouseEnter={e => { e.currentTarget.style.color = colors.textPrimary; e.currentTarget.style.backgroundColor = colors.backgroundCard; }}
            onMouseLeave={e => { e.currentTarget.style.color = colors.textSecondary; e.currentTarget.style.backgroundColor = 'transparent'; }}
            aria-label={isFocusMode ? i18n.t('titleBar.exitFocusMode') : i18n.t('titleBar.enterFocusMode')}
          >
            <span className="transition-transform duration-250 ease-out" style={{ transform: isFocusMode ? 'rotate(0deg)' : 'rotate(180deg)', transition: 'transform 0.25s cubic-bezier(0.4, 0, 0.2, 1)' }}>
              <CollapseIcon />
            </span>
          </button>
          <button
            onClick={minimize}
            className="w-[46px] h-full flex items-center justify-center transition-colors"
            style={{ color: colors.textSecondary }}
            onMouseEnter={e => { e.currentTarget.style.color = colors.textPrimary; e.currentTarget.style.backgroundColor = colors.backgroundCard; }}
            onMouseLeave={e => { e.currentTarget.style.color = colors.textSecondary; e.currentTarget.style.backgroundColor = 'transparent'; }}
            aria-label={i18n.t('titleBar.minimize')}
          >
            <MinimizeIcon />
          </button>
          <button
            onClick={maximize}
            className="w-[46px] h-full flex items-center justify-center transition-colors"
            style={{ color: colors.textSecondary }}
            onMouseEnter={e => { e.currentTarget.style.color = colors.textPrimary; e.currentTarget.style.backgroundColor = colors.backgroundCard; }}
            onMouseLeave={e => { e.currentTarget.style.color = colors.textSecondary; e.currentTarget.style.backgroundColor = 'transparent'; }}
            aria-label={isMaximized ? i18n.t('titleBar.restore') : i18n.t('titleBar.maximize')}
          >
            {isMaximized ? <RestoreIcon /> : <MaximizeIcon />}
          </button>
          <button
            onClick={close}
            className="w-[46px] h-full flex items-center justify-center transition-colors"
            style={{ color: colors.textSecondary }}
            onMouseEnter={e => { e.currentTarget.style.color = '#fff'; e.currentTarget.style.backgroundColor = '#c42b1c'; }}
            onMouseLeave={e => { e.currentTarget.style.color = colors.textSecondary; e.currentTarget.style.backgroundColor = 'transparent'; }}
            aria-label={i18n.t('titleBar.close')}
          >
            <CloseIcon />
          </button>
        </div>
      </div>
    );
});

TitleBar.displayName = 'TitleBar';

export default TitleBar;
