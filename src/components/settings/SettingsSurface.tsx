import { useEffect, useRef, useState } from 'react';
import { getDesktopAPI, type DesktopAPI } from '../../services/desktopAdapter';
import { useCommandPaletteState } from '../../hooks/useCommandPalette';
import SettingsView, { type SettingsSectionId } from './SettingsView';
import NativeSettings, { nativeSettingsBuilt } from './native/NativeSettings';

/** Darwin 25 is macOS 26, the first release with the Liquid Glass the native sheet is drawn on. */
const NATIVE_SETTINGS_DARWIN_MAJOR = 25;
/** Startup work settles first; building the sheet takes the main process about a frame's worth of time. */
const PREWARM_DELAY_MS = 4000;
const noop = () => {};

/** Whether settings open as the AppKit sheet; older macOS and other platforms keep the web sheet. */
export function supportsNativeSettings(desktop: DesktopAPI | null | undefined): boolean {
  if (desktop?.platform !== 'darwin' || !desktop.ipc?.nativeSettings) return false;
  return Number.parseInt(desktop.osRelease ?? '', 10) >= NATIVE_SETTINGS_DARWIN_MAJOR;
}

/**
 * Builds the native sheet's views once the app has settled, so the first open only updates
 * them, as Cmd+K does. Only AppKit views stay behind; no second renderer is kept.
 */
export function NativeSettingsPrewarm() {
  const supported = supportsNativeSettings(getDesktopAPI());
  const [building, setBuilding] = useState(false);
  const [done, setDone] = useState(() => nativeSettingsBuilt());
  useEffect(() => {
    if (!supported || done) return;
    let idle = 0;
    const timer = setTimeout(() => {
      // jsdom has no idle callbacks; Chromium always does.
      if (typeof window.requestIdleCallback !== 'function') { setBuilding(true); return; }
      idle = window.requestIdleCallback(() => setBuilding(true), { timeout: 2000 });
    }, PREWARM_DELAY_MS);
    return () => { clearTimeout(timer); if (idle) window.cancelIdleCallback(idle); };
  }, [done, supported]);
  if (!supported || done || !building) return null;
  return <NativeSettings prewarm initialSection="general" onClose={noop} onPreviewWelcome={noop}
    fallback={() => null} onPrewarmed={() => setDone(true)} />;
}

interface SettingsSurfaceProps {
  initialSection: SettingsSectionId;
  onClose: () => void;
  /** Shows the first-launch welcome page in the player window; settings close first. */
  onPreviewWelcome: () => void;
}

export default function SettingsSurface({ initialSection, onClose, onPreviewWelcome }: SettingsSurfaceProps) {
  const desktop = getDesktopAPI();
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const palette = useCommandPaletteState();

  // Both the web sheet and the native sheet give way to the command palette.
  useEffect(() => { if (palette.open) closeRef.current(); }, [palette.open]);

  const previewWelcome = () => { onClose(); onPreviewWelcome(); };
  const web = () => <SettingsView initialSection={initialSection} onClose={onClose} usePaletteMaterial={desktop?.platform === 'darwin'}
    onPreviewWelcome={previewWelcome} />;
  if (!supportsNativeSettings(desktop)) return web();
  return <NativeSettings initialSection={initialSection} onClose={onClose} onPreviewWelcome={previewWelcome} fallback={web} />;
}
