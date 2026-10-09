import { useEffect, useState } from 'react';
import { getDesktopAPI } from '../../services/desktopAdapter';
import { themeManager } from '../../services/themeManager';
import { logger } from '../../services/logger';
import SettingsView from './SettingsView';
import type { SettingsSectionId } from '../../types/settingsPanel';
import { shortcutManager, type ShortcutAction } from '../../services/shortcuts';

export default function SettingsWindow({ section }: { section: SettingsSectionId }) {
  const api = getDesktopAPI()?.ipc?.settingsPanel;
  const [activeSection, setActiveSection] = useState(section);
  useEffect(() => api?.onSection(setActiveSection), [api]);
  useEffect(() => {
    if (!api) return;
    const forward = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing) return;
      const target = event.target;
      const textInput = target instanceof HTMLTextAreaElement || (target instanceof HTMLElement && target.isContentEditable)
        || (target instanceof HTMLInputElement && !['button', 'checkbox', 'color', 'file', 'image', 'radio', 'range', 'reset', 'submit'].includes(target.type));
      if (textInput && !event.metaKey && !event.ctrlKey && !event.altKey) return;
      const actions = Object.keys(shortcutManager.getAllShortcuts()) as ShortcutAction[];
      if (!actions.some(action => shortcutManager.matchesShortcut(action, event, action === 'cyclePlaylists'))) return;
      event.preventDefault();
      const modifiers = Number(event.metaKey) | (Number(event.ctrlKey) << 1) | (Number(event.altKey) << 2) | (Number(event.shiftKey) << 3);
      void api.forwardShortcut(event.key, modifiers).catch(error => logger.warn('[SettingsPanel] Shortcut failed:', error));
    };
    window.addEventListener('keydown', forward);
    return () => window.removeEventListener('keydown', forward);
  }, [api]);
  useEffect(() => {
    if (!api) return;
    const target = window as unknown as { bg_blur_trans?: (value: number) => void };
    target.bg_blur_trans = value => { void api.previewOpacity(value); };
    return () => { delete target.bg_blur_trans; };
  }, [api]);
  useEffect(() => {
    themeManager.applyCurrentTheme();
    const sheet = document.querySelector<HTMLElement>('.settings-sheet');
    const content = sheet?.querySelector<HTMLElement>('.settings-sheet__content');
    const header = sheet?.querySelector<HTMLElement>('.settings-sheet__header');
    if (!sheet || !content || !header || !api) return;
    let frame = 0;
    let lastHeight = 0;
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const height = header.offsetHeight + content.scrollHeight;
        if (height === lastHeight || !height) return;
        lastHeight = height;
        void api.ready(height).catch(error => logger.warn('[SettingsPanel] Resize failed:', error));
      });
    };
    const resize = new ResizeObserver(measure);
    resize.observe(header); resize.observe(content);
    const mutations = new MutationObserver(measure);
    mutations.observe(content, { childList: true, subtree: true, attributes: true, characterData: true });
    measure();
    return () => { cancelAnimationFrame(frame); resize.disconnect(); mutations.disconnect(); };
  }, [api]);
  return <SettingsView initialSection={activeSection} onClose={() => { void api?.close(); }} />;
}
