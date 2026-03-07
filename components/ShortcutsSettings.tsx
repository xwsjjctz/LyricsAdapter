import React, { useState, useEffect, useCallback, useRef } from 'react';
import { i18n } from '../services/i18n';
import { shortcutManager, ShortcutAction, ShortcutConfig, DEFAULT_SHORTCUTS } from '../services/shortcuts';

interface ShortcutsSettingsProps {}

const ShortcutsSettings: React.FC<ShortcutsSettingsProps> = () => {
  const [shortcuts, setShortcuts] = useState<Record<ShortcutAction, ShortcutConfig>>({} as Record<ShortcutAction, ShortcutConfig>);
  const [editingAction, setEditingAction] = useState<ShortcutAction | null>(null);
  const [conflictAction, setConflictAction] = useState<ShortcutAction | null>(null);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

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

    if (event.ctrlKey) parts.push('CmdOrCtrl');
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

  const groupedShortcuts = {
    player: Object.entries(shortcuts).filter(([, config]) => config?.scope === 'player') as [ShortcutAction, ShortcutConfig][],
    navigation: Object.entries(shortcuts).filter(([, config]) => config?.scope === 'navigation') as [ShortcutAction, ShortcutConfig][]
  };

  if (Object.keys(shortcuts).length === 0) {
    return null;
  }

  // 渲染单行快捷键
  const renderShortcutRow = (action: ShortcutAction, config: ShortcutConfig, isLast: boolean) => (
    <div
      key={action}
      className={`flex items-center justify-between py-2 px-3 ${!isLast ? 'border-b border-white/5' : ''}`}
    >
      <span className="text-xs text-white/70 min-w-[80px]">{i18n.t(config.name)}</span>

      <div className="flex items-center gap-1.5">
        {editingAction === action ? (
          <div className="relative">
            <input
              ref={inputRef}
              type="text"
              readOnly
              className="w-20 px-2 py-1 bg-primary/20 border border-primary/50 rounded text-xs text-primary text-center outline-none"
              placeholder={i18n.t('settings.shortcuts.pressKey')}
              onKeyDown={(e) => handleKeyDown(e, action)}
              onBlur={() => {
                setEditingAction(null);
                setConflictAction(null);
              }}
            />
            {conflictAction && (
              <div className="absolute top-full right-0 mt-1 w-40 p-1.5 bg-red-500/20 border border-red-500/30 rounded text-xs text-red-400 z-10">
                {i18n.t('settings.shortcuts.conflict')}: {i18n.t(shortcuts[conflictAction]?.name || '')}
              </div>
            )}
          </div>
        ) : (
          <button
            onClick={() => setEditingAction(action)}
            className={`min-w-[50px] px-2 py-1 rounded text-xs font-mono transition-colors ${
              !config.currentKey
                ? 'bg-white/5 text-white/30 italic hover:bg-white/10 hover:text-white/60'
                : config.currentKey !== config.defaultKey
                  ? 'bg-primary/10 text-primary hover:bg-primary/20'
                  : 'bg-white/5 text-white/60 hover:bg-white/10 hover:text-white'
            }`}
            title={i18n.t('settings.shortcuts.clickToEdit')}
          >
            {config.currentKey ? displayKey(config.currentKey) : '-'}
          </button>
        )}

        {(config.currentKey !== config.defaultKey || !config.currentKey) && (
          <button
            onClick={() => handleReset(action)}
            className="p-1 text-white/30 hover:text-white/60 transition-colors"
            title={config.currentKey ? i18n.t('settings.shortcuts.reset') : i18n.t('settings.shortcuts.clear')}
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
    <div className="space-y-3">
      {/* Header with Reset All button */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-white">{i18n.t('settings.shortcuts.title')}</h3>
        <button
          onClick={() => setShowResetConfirm(true)}
          className="px-2.5 py-1 text-xs text-white/60 hover:text-white bg-white/5 hover:bg-white/10 rounded transition-colors"
        >
          {i18n.t('settings.shortcuts.resetAll')}
        </button>
      </div>

      {/* 双列布局：播放器 + 导航 */}
      <div className="grid grid-cols-2 gap-3">
        {/* Player Shortcuts */}
        <div className="bg-white/5 border border-white/10 rounded-lg overflow-hidden">
          <div className="px-3 py-1.5 border-b border-white/10 bg-white/[0.02]">
            <span className="text-xs font-medium text-white/50">{i18n.t('settings.shortcuts.playerGroup')}</span>
          </div>
          <div>
            {groupedShortcuts.player?.map(([action, config], index) => 
              renderShortcutRow(action, config, index === (groupedShortcuts.player?.length || 0) - 1)
            )}
          </div>
        </div>

        {/* Navigation Shortcuts */}
        <div className="bg-white/5 border border-white/10 rounded-lg overflow-hidden">
          <div className="px-3 py-1.5 border-b border-white/10 bg-white/[0.02]">
            <span className="text-xs font-medium text-white/50">{i18n.t('settings.shortcuts.navigationGroup')}</span>
          </div>
          <div>
            {groupedShortcuts.navigation?.map(([action, config], index) => 
              renderShortcutRow(action, config, index === (groupedShortcuts.navigation?.length || 0) - 1)
            )}
          </div>
        </div>
      </div>

      {/* 提示信息 */}
      <div className="flex items-center gap-2 px-3 py-2 bg-white/[0.02] border border-white/10 rounded-lg">
        <span className="material-symbols-outlined text-white/40 text-sm">info</span>
        <span className="text-xs text-white/40">{i18n.t('settings.shortcuts.legend')}</span>
      </div>

      {/* Reset All Confirmation Modal */}
      {showResetConfirm && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-[#1a2533] border border-white/10 rounded-xl p-5 max-w-sm w-full mx-4">
            <h4 className="text-base font-medium text-white mb-2">{i18n.t('settings.shortcuts.resetAllConfirm')}</h4>
            <p className="text-sm text-white/60 mb-4">{i18n.t('settings.shortcuts.resetAllDesc')}</p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setShowResetConfirm(false)}
                className="px-3 py-1.5 text-sm text-white/60 hover:text-white transition-colors"
              >
                {i18n.t('common.cancel')}
              </button>
              <button
                onClick={handleResetAll}
                className="px-3 py-1.5 text-sm bg-primary/20 text-primary hover:bg-primary/30 rounded-lg transition-colors"
              >
                {i18n.t('settings.shortcuts.resetAll')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ShortcutsSettings;
