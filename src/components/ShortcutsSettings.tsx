import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { shortcutManager, ShortcutAction, ShortcutConfig } from '../services/shortcuts';
import { themeManager } from '../services/themeManager';
import { ThemeConfig } from '../types/theme';
import ConfirmDialog from './ConfirmDialog';
import Button from './ui/Button';

interface ShortcutsSettingsProps {
  layout?: 'single' | 'two-column';
}

const ShortcutsSettings: React.FC<ShortcutsSettingsProps> = ({ layout = 'two-column' }) => {
  const { t } = useTranslation();
  const [shortcuts, setShortcuts] = useState<Record<ShortcutAction, ShortcutConfig>>({} as Record<ShortcutAction, ShortcutConfig>);
  const [editingAction, setEditingAction] = useState<ShortcutAction | null>(null);
  const [conflictAction, setConflictAction] = useState<ShortcutAction | null>(null);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [currentTheme, setCurrentTheme] = useState<ThemeConfig>(themeManager.getCurrentTheme());
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const unsubscribe = themeManager.subscribe(() => {
      setCurrentTheme(themeManager.getCurrentTheme());
    });
    return unsubscribe;
  }, []);

  const colors = currentTheme.colors;

  useEffect(() => {
    setShortcuts(shortcutManager.getAllShortcuts());
  }, []);

  useEffect(() => {
    if (editingAction && inputRef.current) {
      inputRef.current.focus();
    }
  }, [editingAction]);

  const formatKey = useCallback((event: React.KeyboardEvent): string => {
    const parts: string[] = [];

    if (event.ctrlKey || event.metaKey) parts.push('CmdOrCtrl');
    if (event.altKey) parts.push('Alt');
    if (event.shiftKey) parts.push('Shift');

    // Handle special keys
    let key = event.key;
    if (key === ' ') key = 'Space';
    if (key === 'ArrowLeft') key = 'Left';
    if (key === 'ArrowRight') key = 'Right';
    if (key === 'ArrowUp') key = 'Up';
    if (key === 'ArrowDown') key = 'Down';
    if (key === ',') key = ',';

    // Only add the key if it's not a modifier
    if (!['Control', 'Alt', 'Shift', 'Meta'].includes(event.key)) {
      parts.push(key);
    }

    return parts.join('+');
  }, []);

  const handleKeyDown = useCallback((event: React.KeyboardEvent, action: ShortcutAction) => {
    event.preventDefault();
    event.stopPropagation();

    // Escape cancels editing
    if (event.key === 'Escape') {
      setEditingAction(null);
      setConflictAction(null);
      return;
    }

    // Backspace/Delete clears the shortcut
    if (event.key === 'Backspace' || event.key === 'Delete') {
      shortcutManager.updateShortcut(action, '');
      setShortcuts(shortcutManager.getAllShortcuts());
      setEditingAction(null);
      setConflictAction(null);
      return;
    }

    const newKey = formatKey(event);

    // Check if it's a valid shortcut (needs at least a key)
    if (!newKey || newKey === 'CmdOrCtrl' || newKey === 'Alt' || newKey === 'Shift') {
      return;
    }

    // Check for conflicts
    const conflict = shortcutManager.findConflict(action, newKey);
    if (conflict) {
      setConflictAction(conflict);
      return;
    }

    // Update the shortcut
    const success = shortcutManager.updateShortcut(action, newKey);
    if (success) {
      setShortcuts(shortcutManager.getAllShortcuts());
      setEditingAction(null);
      setConflictAction(null);
    }
  }, [formatKey]);

  const handleReset = useCallback((action: ShortcutAction) => {
    shortcutManager.resetToDefault(action);
    setShortcuts(shortcutManager.getAllShortcuts());
  }, []);

  const handleResetAll = useCallback(() => {
    shortcutManager.resetAllToDefaults();
    setShortcuts(shortcutManager.getAllShortcuts());
    setShowResetConfirm(false);
  }, []);

  const displayKey = useCallback((key: string): string => {
    return shortcutManager.formatKeyForDisplay(key);
  }, []);

  const allShortcuts = React.useMemo(() => {
    return (Object.entries(shortcuts) as [ShortcutAction, ShortcutConfig][])
      .filter(([action, config]) => config && action !== 'gotoBrowse' && action !== 'gotoMetadata');
  }, [shortcuts]);

  if (Object.keys(shortcuts).length === 0) {
    return null;
  }

  // 渲染单行快捷键
  const renderShortcutRow = (action: ShortcutAction, config: ShortcutConfig) => (
    <div
      key={action}
      className="flex items-center justify-between py-1.5 px-3 border-b"
      style={{ borderColor: colors.borderLight }}
    >
      <span className="text-xs min-w-[80px]" style={{ color: colors.textSecondary }}>{t(config.name)}</span>

      <div className="flex items-center gap-1.5">
        {editingAction === action ? (
          <div className="relative">
            <input
              ref={inputRef}
              type="text"
              readOnly
              className="w-20 px-2 py-1 r-sm text-xs text-center outline-none"
              style={{ backgroundColor: `${colors.primary}20`, border: `1px solid ${colors.primary}50`, color: colors.primary }}
              placeholder={t('settings.shortcuts.pressKey')}
              onKeyDown={(e) => handleKeyDown(e, action)}
              onBlur={() => {
                setEditingAction(null);
                setConflictAction(null);
              }}
            />
            {conflictAction && (
              <div className="absolute top-full right-0 mt-1 w-40 p-1.5 r-sm text-xs z-10" style={{ backgroundColor: `${colors.error}20`, border: `1px solid ${colors.error}30`, color: colors.error }}>
                {t('settings.shortcuts.conflict')}: {t(shortcuts[conflictAction]?.name || '')}
              </div>
            )}
          </div>
        ) : (
          <button
            onClick={() => setEditingAction(action)}
            className="min-w-[50px] px-2 py-1 r-sm text-xs font-mono transition-colors"
            style={{
              backgroundColor: !config.currentKey ? colors.backgroundCard : config.currentKey !== config.defaultKey ? `${colors.primary}10` : colors.backgroundCard,
              color: !config.currentKey ? colors.textMuted : config.currentKey !== config.defaultKey ? colors.primary : colors.textSecondary,
            }}
            onMouseEnter={e => {
              if (config.currentKey) {
                e.currentTarget.style.backgroundColor = config.currentKey !== config.defaultKey ? `${colors.primary}20` : colors.backgroundCardHover;
              } else {
                e.currentTarget.style.backgroundColor = colors.backgroundCardHover;
                e.currentTarget.style.color = colors.textSecondary;
              }
            }}
            onMouseLeave={e => {
              if (config.currentKey) {
                e.currentTarget.style.backgroundColor = config.currentKey !== config.defaultKey ? `${colors.primary}10` : colors.backgroundCard;
              } else {
                e.currentTarget.style.backgroundColor = colors.backgroundCard;
                e.currentTarget.style.color = colors.textMuted;
              }
            }}
            title={t('settings.shortcuts.clickToEdit')}
          >
            {config.currentKey ? displayKey(config.currentKey) : '-'}
          </button>
        )}

        {(config.currentKey !== config.defaultKey || !config.currentKey) && (
          <button
            onClick={() => handleReset(action)}
            className="ui-icon-btn ui-icon-btn--ghost ui-icon-btn--sm"
            aria-label={config.currentKey ? t('settings.shortcuts.reset') : t('settings.shortcuts.clear')}
          >
            <span className="material-symbols-outlined text-sm">
              {config.currentKey ? 'restart_alt' : 'backspace'}
            </span>
          </button>
        )}
      </div>
    </div>
  );

  return (
    <section className="r-card p-4 border" style={{ backgroundColor: colors.backgroundCard, borderColor: colors.borderLight }}>
      {/* Header with Reset All button */}
      <div className="flex items-center justify-between gap-2 mb-2">
        <h3 className="text-sm font-medium flex items-center gap-2" style={{ color: colors.textPrimary }}>
          <span className="material-symbols-outlined text-lg" style={{ color: colors.primary }}>keyboard</span>
          {t('settings.shortcuts.title')}
        </h3>
        <Button variant="secondary" size="sm" onClick={() => setShowResetConfirm(true)}>
          {t('settings.shortcuts.resetAll')}
        </Button>
      </div>

      <div className="r-card overflow-hidden border" style={{ backgroundColor: colors.backgroundCard, borderColor: colors.borderLight }}>
        <div className={layout === 'single' ? 'grid grid-cols-1' : 'grid grid-cols-2'}>
          {allShortcuts.map(([action, config]) =>
            renderShortcutRow(action, config)
          )}
        </div>
      </div>

      {/* 提示信息 */}
      <div className="flex items-center gap-2 px-3 py-2 r-card border mt-2" style={{ backgroundColor: colors.backgroundCardHover, borderColor: colors.borderLight }}>
        <span className="material-symbols-outlined text-sm" style={{ color: colors.textMuted }}>info</span>
        <span className="text-xs" style={{ color: colors.textMuted }}>{t('settings.shortcuts.legend')}</span>
      </div>

      <ConfirmDialog
        isOpen={showResetConfirm}
        title={t('settings.shortcuts.resetAllConfirm')}
        message={t('settings.shortcuts.resetAllDesc')}
        confirmLabel={t('settings.shortcuts.resetAll')}
        tone="primary"
        onConfirm={handleResetAll}
        onCancel={() => setShowResetConfirm(false)}
      />
    </section>
  );
};

export default ShortcutsSettings;
