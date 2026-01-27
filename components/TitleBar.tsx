import React from 'react';
import { useWindowControls } from '../hooks/useWindowControls';

const TitleBar: React.FC = () => {
  const { canControl } = useWindowControls();

  // 检测是否在 macOS
  const isMacOS = typeof window !== 'undefined' &&
                  ((window as any).electron?.platform === 'darwin' ||
                   (window as any).__TAURI_INTERNALS__?.platform === 'darwin');

  // 检测是否在 Tauri 环境
  const isTauri = typeof window !== 'undefined' &&
                  ((window as any).__TAURI_INTERNALS__ ||
                   navigator.userAgent.includes('Tauri'));

  // 如果不在桌面环境，不显示标题栏
  if (!canControl) {
    return null;
  }

  // Tauri 不支持背景延伸，不显示自定义标题栏
  if (isTauri) {
    return null;
  }

  // macOS Electron 使用系统原生标题栏，显示透明标题栏区域
  if (isMacOS) {
    return (
      <div
        className="fixed top-0 left-0 right-0 h-8 bg-transparent select-none z-50"
        style={{
          WebkitAppRegion: 'drag', // 允许拖动窗口
          WebkitUserSelect: 'none',
          userSelect: 'none'
        } as React.CSSProperties}
      >
        {/* macOS 系统会在左侧显示红绿黄按钮 */}
      </div>
    );
  }

  // Windows/Linux 显示自定义标题栏
  return null;
};

export default TitleBar;
