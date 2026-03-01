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

  return (
    <div className="space-y-6">
      {/* Header with Reset All button */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-base font-medium text-white">{i18n.t('settings.shortcuts.title')}</h3>
          <p className="text-xs text-white/40 mt-0.5">{i18n.t('settings.shortcuts.description')}</p>
        </div>
        <button
          onClick={() => setShowResetConfirm(true)}
          className="px-4 py-2 text-sm text-white/60 hover:text-white bg-white/5 hover:bg-white/10 rounded-lg transition-colors"
        >
          {i18n.t('settings.shortcuts.resetAll')}
        </button>
      </div>

      {/* Player Shortcuts */}
      <section>
        <h4 className="text-xs font-semibold text-white/30 uppercase tracking-wider mb-3 px-1">
          {i18n.t('settings.shortcuts.playerGroup')}
        </h4>
        <div className="bg-white/5 border border-white/10 rounded-xl overflow-hidden">
          {groupedShortcuts.player?.map(([action, config], index) => (
            <div
              key={action}
              className={`flex items-center justify-between px-5 py-4 ${
                index !== (groupedShortcuts.player?.length || 0) - 1 ? 'border-b border-white/5' : ''
              }`}
            >
              <div className="flex-1">
                <div className="text-sm text-white/90">{i18n.t(config.name)}</div>
                <div className="text-xs text-white/40 mt-0.5">{i18n.t(config.description)}</div>
              </div>
              
              <div className="flex items-center gap-3">
                {editingAction === action ? (
                  <div className="relative">
                    <input
                      ref={inputRef}
                      type="text"
                      readOnly
                      className="w-40 px-3 py-2 bg-primary/20 border border-primary/50 rounded-lg text-sm text-primary text-center outline-none"
                      placeholder={i18n.t('settings.shortcuts.pressKey')}
                      onKeyDown={(e) => handleKeyDown(e, action)}
                      onBlur={() => {
                        setEditingAction(null);
                        setConflictAction(null);
                      }}
                    />
                    {conflictAction && (
                      <div className="absolute top-full right-0 mt-2 w-48 p-2 bg-red-500/20 border border-red-500/30 rounded-lg text-xs text-red-400 z-10">
                        {i18n.t('settings.shortcuts.conflict')}: {i18n.t(shortcuts[conflictAction]?.name || '')}
                      </div>
                    )}
                  </div>
                ) : (
                  <button
                    onClick={() => setEditingAction(action)}
                    className={`min-w-[100px] px-4 py-2 rounded-lg text-sm font-mono transition-colors ${
                      !config.currentKey 
                        ? 'bg-white/5 text-white/30 italic hover:bg-white/10 hover:text-white/60'
                        : config.currentKey !== config.defaultKey
                          ? 'bg-primary/10 text-primary hover:bg-primary/20'
                          : 'bg-white/5 text-white/60 hover:bg-white/10 hover:text-white'
                    }`}
                    title={i18n.t('settings.shortcuts.clickToEdit')}
                  >
                    {config.currentKey ? displayKey(config.currentKey) : i18n.t('settings.shortcuts.unbound')}
                  </button>
                )}
                
                {(config.currentKey !== config.defaultKey || config.currentKey) && (
                  <button
                    onClick={() => handleReset(action)}
                    className="p-2 text-white/30 hover:text-white/60 transition-colors"
                    title={config.currentKey ? i18n.t('settings.shortcuts.reset') : i18n.t('settings.shortcuts.clear')}
                  >
                    <span className="material-symbols-outlined text-lg">
                      {config.currentKey ? 'restart_alt' : 'backspace'}
                    </span>
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Navigation Shortcuts */}
      <section>
        <h4 className="text-xs font-semibold text-white/30 uppercase tracking-wider mb-3 px-1">
          {i18n.t('settings.shortcuts.navigationGroup')}
        </h4>
        <div className="bg-white/5 border border-white/10 rounded-xl overflow-hidden">
          {groupedShortcuts.navigation?.map(([action, config], index) => (
            <div
              key={action}
              className={`flex items-center justify-between px-5 py-4 ${
                index !== (groupedShortcuts.navigation?.length || 0) - 1 ? 'border-b border-white/5' : ''
              }`}
            >
              <div className="flex-1">
                <div className="text-sm text-white/90">{i18n.t(config.name)}</div>
                <div className="text-xs text-white/40 mt-0.5">{i18n.t(config.description)}</div>
              </div>
              
              <div className="flex items-center gap-3">
                {editingAction === action ? (
                  <div className="relative">
                    <input
                      ref={inputRef}
                      type="text"
                      readOnly
                      className="w-40 px-3 py-2 bg-primary/20 border border-primary/50 rounded-lg text-sm text-primary text-center outline-none"
                      placeholder={i18n.t('settings.shortcuts.pressKey')}
                      onKeyDown={(e) => handleKeyDown(e, action)}
                      onBlur={() => {
                        setEditingAction(null);
                        setConflictAction(null);
                      }}
                    />
                    {conflictAction && (
                      <div className="absolute top-full right-0 mt-2 w-48 p-2 bg-red-500/20 border border-red-500/30 rounded-lg text-xs text-red-400 z-10">
                        {i18n.t('settings.shortcuts.conflict')}: {i18n.t(shortcuts[conflictAction]?.name || '')}
                      </div>
                    )}
                  </div>
                ) : (
                  <button
                    onClick={() => setEditingAction(action)}
                    className={`px-4 py-2 rounded-lg text-sm font-mono transition-colors ${
                      config.currentKey !== config.defaultKey
                        ? 'bg-primary/10 text-primary hover:bg-primary/20'
                        : 'bg-white/5 text-white/60 hover:bg-white/10 hover:text-white'
                    }`}
                    title={i18n.t('settings.shortcuts.clickToEdit')}
                  >
                    {displayKey(config.currentKey)}
                  </button>
                )}
                
                {config.currentKey !== config.defaultKey && (
                  <button
                    onClick={() => handleReset(action)}
                    className="p-2 text-white/30 hover:text-white/60 transition-colors"
                    title={i18n.t('settings.shortcuts.reset')}
                  >
                    <span className="material-symbols-outlined text-lg">restart_alt</span>
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Legend */}
      <div className="bg-white/[0.03] border border-white/10 rounded-xl p-4">
        <div className="flex items-start gap-3">
          <span className="material-symbols-outlined text-white/40 text-lg">info</span>
          <div className="text-xs text-white/40 space-y-1">
            <p>{i18n.t('settings.shortcuts.legend')}</p>
            <p>{i18n.t('settings.shortcuts.legendClear')}</p>
          </div>
        </div>
      </div>

      {/* Reset All Confirmation Modal */}
      {showResetConfirm && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-[#1a2533] border border-white/10 rounded-xl p-6 max-w-sm w-full mx-4">
            <h4 className="text-lg font-medium text-white mb-2">{i18n.t('settings.shortcuts.resetAllConfirm')}</h4>
            <p className="text-sm text-white/60 mb-6">{i18n.t('settings.shortcuts.resetAllDesc')}</p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setShowResetConfirm(false)}
                className="px-4 py-2 text-sm text-white/60 hover:text-white transition-colors"
              >
                {i18n.t('common.cancel')}
              </button>
              <button
                onClick={handleResetAll}
                className="px-4 py-2 text-sm bg-primary/20 text-primary hover:bg-primary/30 rounded-lg transition-colors"
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
