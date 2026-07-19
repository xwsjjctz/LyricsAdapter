import React, { memo, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getDesktopAPI } from '../services/desktopAdapter';
import { themeManager } from '../services/themeManager';
import { ThemeConfig } from '../types/theme';

interface SidebarToggleButtonProps {
  onToggle: () => void;
  collapsed: boolean;
}

/**
 * Sidebar collapse/expand toggle. Rendered as a fixed-position element outside
 * the TitleBar's `z-[160]` stacking context so that FocusMode (z-120) can cover
 * it when fully expanded. Stays above page content (z-20) so it remains
 * clickable over the sidebar.
 */
const SidebarToggleButton: React.FC<SidebarToggleButtonProps> = memo(({ onToggle, collapsed }) => {
  const { t } = useTranslation();
  const [currentTheme, setCurrentTheme] = useState<ThemeConfig>(themeManager.getCurrentTheme());

  useEffect(() => {
    const unsubscribe = themeManager.subscribe(() => {
      setCurrentTheme(themeManager.getCurrentTheme());
    });
    return unsubscribe;
  }, []);

  const desktopAPI = getDesktopAPI();
  const platform = desktopAPI?.platform || '';
  const isMacOS = platform === 'darwin';

  const colors = currentTheme.colors;
  // Position relative to where the button used to live inside the TitleBar's
  // macOS row: 55px traffic-lights spacer + 32.4px blue-dot button
  // (pl-[18px] + 12.4px circle + pr-0.5 = 2px) ≈ 87.4px → round to 88px so
  // the wrapper's left edge butts up against the blue button like before.
  const topOffset = 0;
  const leftOffset = isMacOS ? 88 : 8;
  const height = isMacOS ? 38 : 36;

  return (
    <div
      data-no-gsap-bounce
      className="fixed flex items-center select-none z-[30]"
      style={{
        top: topOffset,
        left: leftOffset,
        height,
        WebkitAppRegion: 'no-drag',
        userSelect: 'none',
      } as React.CSSProperties}
    >
      <span className="w-8 h-8 flex items-center justify-center">
        <button
          onClick={onToggle}
          data-no-gsap-bounce
          className="w-7 h-7 flex items-center justify-center rounded-md transition-colors"
          style={{ color: colors.textSecondary }}
          onMouseEnter={e => {
            e.currentTarget.style.color = colors.textPrimary;
            e.currentTarget.style.backgroundColor = colors.backgroundCard;
          }}
          onMouseLeave={e => {
            e.currentTarget.style.color = colors.textSecondary;
            e.currentTarget.style.backgroundColor = 'transparent';
          }}
          aria-label={collapsed ? t('titleBar.expandSidebar') : t('titleBar.collapseSidebar')}
        >
          <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
            {collapsed ? 'left_panel_open' : 'left_panel_close'}
          </span>
        </button>
      </span>
    </div>
  );
});

SidebarToggleButton.displayName = 'SidebarToggleButton';

export default SidebarToggleButton;