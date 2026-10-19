import React, { Fragment, useState, useEffect, useCallback, useRef } from 'react';
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
  // Read on the first render, so the list does not appear a moment later and move the settings list.
  const [shortcuts, setShortcuts] = useState<Record<ShortcutAction, ShortcutConfig>>(() => shortcutManager.getAllShortcuts());
  const [editingAction, setEditingAction] = useState<ShortcutAction | null>(null);
  // The recorded key and the action that already uses it, waiting for Replace or a second press.
  const [conflict, setConflict] = useState<{ action: ShortcutAction; key: string } | null>(null);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [currentTheme, setCurrentTheme] = useState<ThemeConfig>(themeManager.getCurrentTheme());
  const inputRef = useRef<HTMLInputElement>(null);
  const sectionRef = useRef<HTMLElement>(null);
  // Set when the keyboard ends a recording: the recorder unmounts, and without
  // this focus would drop to the page body, where Escape no longer closes settings.
  const restoreFocusTo = useRef<ShortcutAction | null>(null);

  useEffect(() => {
    const unsubscribe = themeManager.subscribe(() => {
      setCurrentTheme(themeManager.getCurrentTheme());
    });
    return unsubscribe;
  }, []);

  const colors = currentTheme.colors;

  useEffect(() => {
    if (editingAction && inputRef.current) {
      inputRef.current.focus();
      return;
    }
    const action = restoreFocusTo.current;
    restoreFocusTo.current = null;
    if (action) sectionRef.current?.querySelector<HTMLElement>(`[data-shortcut-edit="${action}"]`)?.focus();
  }, [editingAction]);

  const finishRecording = useCallback((action: ShortcutAction) => {
    restoreFocusTo.current = action;
    setEditingAction(null);
    setConflict(null);
  }, []);

  const replace = useCallback((action: ShortcutAction, key: string) => {
    shortcutManager.replaceShortcut(action, key);
    setShortcuts(shortcutManager.getAllShortcuts());
    finishRecording(action);
  }, [finishRecording]);

  const formatKey = useCallback((event: React.KeyboardEvent): string => {
    const parts: string[] = [];

    if (event.ctrlKey || event.metaKey) parts.push('CmdOrCtrl');
    if (event.altKey) parts.push('Alt');
    if (event.shiftKey) parts.push('Shift');

    // Handle special keys
    let key = event.key;
    if (event.code === 'Backquote') key = 'Backquote';
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
      finishRecording(action);
      return;
    }

    // Backspace/Delete clears the shortcut
    if (event.key === 'Backspace' || event.key === 'Delete') {
      shortcutManager.updateShortcut(action, '');
      setShortcuts(shortcutManager.getAllShortcuts());
      finishRecording(action);
      return;
    }

    // A chord arrives one key at a time. Keep recording while Cmd/Ctrl,
    // Option or Shift is pressed; only the actual key completes the binding.
    if (['Control', 'Alt', 'Shift', 'Meta'].includes(event.key)) return;

    const newKey = formatKey(event);

    // Check if it's a valid shortcut (needs at least a key)
    if (!newKey || newKey === 'CmdOrCtrl' || newKey === 'Alt' || newKey === 'Shift') {
      return;
    }

    // A key in use asks first; pressing the same key again confirms the replacement.
    const owner = shortcutManager.findConflict(action, newKey);
    if (owner) {
      if (conflict?.key === newKey) {
        replace(action, newKey);
        return;
      }
      setConflict({ action: owner, key: newKey });
      return;
    }

    // Update the shortcut
    const success = shortcutManager.updateShortcut(action, newKey);
    if (success) {
      setShortcuts(shortcutManager.getAllShortcuts());
      finishRecording(action);
    }
  }, [conflict, finishRecording, formatKey, replace]);

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
    <Fragment key={action}>
    <div
      className="flex items-center justify-between py-1.5 px-3 border-b"
      style={{ borderColor: colors.borderLight }}
    >
      <span className="text-xs min-w-[80px]" style={{ color: colors.textSecondary }}>{t(config.name)}</span>

      <div className="flex items-center gap-1.5">
        {editingAction === action ? (
          <div className="relative">
            <input
              ref={inputRef}
              data-shortcut-recorder
              type="text"
              readOnly
              className="w-20 px-2 py-1 r-sm text-xs text-center outline-none"
              style={{ backgroundColor: `${colors.primary}20`, border: `1px solid ${colors.primary}50`, color: colors.primary }}
              placeholder={t('settings.shortcuts.pressKey')}
              onKeyDown={(e) => handleKeyDown(e, action)}
              onBlur={() => {
                setEditingAction(null);
                setConflict(null);
              }}
            />
          </div>
        ) : (
          <button
            data-shortcut-edit={action}
            onClick={() => setEditingAction(action)}
            className="shortcut-key min-w-[50px] px-2 py-1 r-sm text-xs font-mono transition-colors"
            data-state={!config.currentKey ? 'unset' : config.currentKey !== config.defaultKey ? 'custom' : 'default'}
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
            <span className="material-symbols-rounded text-sm">
              {config.currentKey ? 'restart_alt' : 'backspace'}
            </span>
          </button>
        )}
      </div>
    </div>
    {/* Inline under the row: a floating box would be clipped by the list's rounded card. */}
    {editingAction === action && conflict && (
      <div role="alert" className="shortcut-conflict col-span-full flex flex-wrap items-center justify-between gap-2 px-3 py-2 border-b text-xs">
        <span>
          {t('settings.shortcuts.conflictWith', { key: displayKey(conflict.key), name: t(shortcuts[conflict.action]?.name || '') })}
          <span className="shortcut-conflict__hint"> {t('settings.shortcuts.replaceHint')}</span>
        </span>
        {/* Keep the recorder focused: losing it would cancel the recording. */}
        <Button size="sm" variant="primary" onMouseDown={event => event.preventDefault()} onClick={() => replace(action, conflict.key)}>
          {t('settings.shortcuts.replace')}
        </Button>
      </div>
    )}
    </Fragment>
  );

  return (
    // The section heading names this page, so the list is the only card.
    <section ref={sectionRef} className="space-y-2">
      <div className="flex items-center justify-between gap-3 px-1">
        <p className="min-w-0 text-xs" style={{ color: colors.textMuted }}>{t('settings.shortcuts.legend')}</p>
        <Button variant="secondary" size="sm" className="flex-shrink-0" onClick={() => setShowResetConfirm(true)}>
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
