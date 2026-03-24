import React, { memo, useState, useEffect } from 'react';
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

const TitleBar: React.FC = memo(() => {
  const { canControl, minimize, maximize, close, isMaximized } = useWindowControls();

  // Force re-render when language changes
  const [, setLanguageVersion] = useState(0);
  const [currentTheme, setCurrentTheme] = useState<ThemeConfig>(themeManager.getCurrentTheme());

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
  const isWindows = platform === 'win32';

  // 如果不在桌面环境，不显示标题栏
  if (!canControl) {
    return null;
  }

  // macOS Electron 使用系统原生标题栏，显示透明标题栏区域
  if (isMacOS) {
    return (
      <div
        className="fixed top-0 left-0 right-0 h-8 bg-transparent select-none z-50"
        style={{
          WebkitAppRegion: 'drag',
          WebkitUserSelect: 'none',
          userSelect: 'none'
        } as React.CSSProperties}
      >
        {/* macOS 系统会在左侧显示红绿黄按钮 */}
      </div>
    );
  }

  // Windows 渲染自定义标题栏和窗口控制按钮
  if (isWindows) {
    return (
      <div
        className="fixed top-0 left-0 right-0 h-9 bg-transparent select-none z-[100] flex items-center"
        style={{
          WebkitAppRegion: 'drag',
          WebkitUserSelect: 'none',
          userSelect: 'none'
        } as React.CSSProperties}
      >
        {/* 左侧拖动区域 */}
        <div className="flex-1 h-full" />
        
        {/* 右侧窗口控制按钮 */}
        <div 
          className="flex items-center h-full"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
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
  }

  // Linux 或其他平台暂时不显示自定义标题栏
  return null;
});

TitleBar.displayName = 'TitleBar';

export default TitleBar;
