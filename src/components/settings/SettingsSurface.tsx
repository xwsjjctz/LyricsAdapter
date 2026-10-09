import { useEffect, useRef, useState } from 'react';
import { getDesktopAPI } from '../../services/desktopAdapter';
import { logger } from '../../services/logger';
import { useCommandPaletteState } from '../../hooks/useCommandPalette';
import SettingsView, { type SettingsSectionId } from './SettingsView';
import { dispatchForwardedShortcut } from '../palette/nativePaletteState';
import { shortcutManager } from '../../services/shortcuts';
import { setNativeSettingsOwnsKeyboard } from '../../services/nativeSettingsFocus';

export default function SettingsSurface({ initialSection, onClose }: { initialSection: SettingsSectionId; onClose: () => void }) {
  const desktop = getDesktopAPI();
  const api = desktop?.platform === 'darwin' ? desktop.ipc?.settingsPanel : undefined;
  const [native, setNative] = useState<boolean | null>(api ? null : false);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const sectionRef = useRef(initialSection);
  sectionRef.current = initialSection;
  const sentSection = useRef(initialSection);
  const palette = useCommandPaletteState();

  useEffect(() => {
    if (!api) return;
    let cancelled = false;
    let opened = false;
    const unsubscribe = api.onClosed(() => { if (opened && !cancelled) closeRef.current(); });
    const unsubscribePreview = api.onPreviewOpacity(value => {
      const preview = (window as unknown as { bg_blur_trans?: (value: number) => void }).bg_blur_trans;
      preview?.(value);
    });
    const unsubscribeShortcuts = api.onShortcut((key, modifiers) => {
      const event = dispatchForwardedShortcut(key, modifiers);
      if (event && (shortcutManager.matchesShortcut('cyclePlaylists', event, true)
        || shortcutManager.matchesShortcut('toggleFocusMode', event))) closeRef.current();
    });
    sentSection.current = sectionRef.current;
    void api.open(sentSection.current).then(result => {
      if (cancelled) return;
      opened = result.ok && result.data;
      setNative(opened);
    }).catch(error => { logger.warn('[SettingsPanel] Using web settings:', error); if (!cancelled) setNative(false); });
    return () => {
      cancelled = true; unsubscribe(); unsubscribePreview(); unsubscribeShortcuts();
      void api.close().catch(error => logger.warn('[SettingsPanel] Cleanup failed:', error));
    };
  }, [api]);

  useEffect(() => {
    if (api && native && initialSection !== sentSection.current) {
      sentSection.current = initialSection;
      void api.open(initialSection).catch(error => logger.warn('[SettingsPanel] Section change failed:', error));
    }
  }, [api, native, initialSection]);

  useEffect(() => { if (native && palette.open) closeRef.current(); }, [native, palette.open]);
  useEffect(() => {
    // Also while opening: the panel takes the keyboard before `open` resolves.
    setNativeSettingsOwnsKeyboard(native !== false);
    return () => setNativeSettingsOwnsKeyboard(false);
  }, [native]);

  if (native === false) return <SettingsView initialSection={initialSection} onClose={onClose} usePaletteMaterial={desktop?.platform === 'darwin'} />;
  return <div className="settings-sheet-backdrop" data-native-settings="true" data-controlbar-passthrough
    onMouseDown={onClose} onKeyDown={event => { if (event.key === 'Escape') onClose(); }} />;
}
