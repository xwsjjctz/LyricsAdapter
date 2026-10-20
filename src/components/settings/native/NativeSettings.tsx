import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { Language } from '@/i18n';
import { getDesktopAPI } from '@/services/desktopAdapter';
import { setNativeSettingsOwnsKeyboard } from '@/services/nativeSettingsFocus';
import { settingsManager } from '@/services/settingsManager';
import { shortcutManager, type ShortcutAction } from '@/services/shortcuts';
import type { MusicPluginInfo } from '@/shared/musicPlugin';
import type { PluginUpdateSource } from '@/shared/pluginUpdate';
import type { SettingsSectionId } from '@/types/settingsPanel';
import type { NativeSettingsAction, NativeSettingsBlock, NativeSettingsDialog, NativeSettingsRow, NativeSettingsState } from '@/types/nativeSettings';
import { useDocumentDarkMode } from '../../../hooks/useNativePalette';
import { dispatchForwardedShortcut } from '../../palette/nativePaletteState';
import { useShortcutEditor, type RecordedKey } from '../../ShortcutsSettings';
import { useWebdavSettings } from '../hooks/useWebdavSettings';
import { useFocusModeSettings } from '../sections/FocusModeSection';
import { useDownloadPath, useGeneralSettings } from '../sections/GeneralSection';
import { useMusicPluginManager } from '../sections/MusicPluginManager';
import { downloadKey } from '../sections/PluginCatalog';
import { SETTINGS_SECTIONS } from '../SettingsView';
import { LANGUAGE_OPTIONS } from '../shared';
import NativePluginCard, { PLUGIN_CARD_PARTS } from './NativePluginCard';
import {
  SECTION_SYMBOLS, cloudBlocks, focusBlocks, generalBlocks, pluginsBlocks, shortcutsBlocks,
} from './nativeSettingsModel';
import { findRowsHandler, RowsRegistryContext, type RowsHandler, type RowsRegistry } from './useReportedRows';
import { useNativeSettingsSurface } from './useNativeSettingsSurface';

interface NativeSettingsProps {
  initialSection: SettingsSectionId;
  onClose: () => void;
  /** Closes settings and shows the first-launch welcome page. */
  onPreviewWelcome: () => void;
  /** The web sheet, shown when AppKit cannot take over. */
  fallback: () => ReactNode;
  /** Builds the hidden sheet ahead of the first open; `onPrewarmed` runs once AppKit has it. */
  prewarm?: boolean;
  onPrewarmed?: () => void;
}

const SECTION_IDS = new Set<string>(SETTINGS_SECTIONS.map(entry => entry.id));
const SHORTCUT_PREFIX = 'shortcut:';
const NO_SECTIONS: ReadonlySet<string> = new Set();

// AppKit keeps the sheet's views for this page once they are built (closing only hides them).
let sheetBuilt = false;
/** Whether AppKit already holds the sheet's views, so opening only updates them. */
export function nativeSettingsBuilt(): boolean {
  return sheetBuilt;
}

function recordedKey(action: NativeSettingsAction): RecordedKey {
  return {
    key: action.text,
    code: action.code,
    metaKey: (action.value & 1) !== 0,
    ctrlKey: (action.value & 2) !== 0,
    altKey: (action.value & 4) !== 0,
    shiftKey: (action.value & 8) !== 0,
  };
}

/**
 * Settings on macOS 26 and later: an AppKit sheet in the player window, drawn on the same
 * Liquid Glass as Cmd+K. Every value and draft stays in these hooks, shared with the web
 * sheet; AppKit renders the snapshot and reports input back.
 */
export default function NativeSettings(props: NativeSettingsProps) {
  const [failed, setFailed] = useState(false);
  const fail = useCallback(() => setFailed(true), []);
  if (failed) return <>{props.fallback()}</>;
  return <NativeSettingsSheet {...props} onFailed={fail} />;
}

function NativeSettingsSheet({ initialSection, onClose, onPreviewWelcome, onFailed, prewarm = false, onPrewarmed }: NativeSettingsProps & { onFailed: () => void }) {
  const { t, i18n } = useTranslation();
  const api = getDesktopAPI()?.ipc?.nativeSettings;
  const darkMode = useDocumentDarkMode();

  const general = useGeneralSettings();
  const download = useDownloadPath();
  const [downloadRevision, setDownloadRevision] = useState(0);
  const webdav = useWebdavSettings();
  const focus = useFocusModeSettings();
  const editor = useShortcutEditor();
  // A prewarmed sheet is never seen, so nothing it shows is fetched (the plugin catalog).
  const [visible, setVisible] = useState<ReadonlySet<string>>(() => (prewarm ? NO_SECTIONS : new Set([initialSection])));
  const manager = useMusicPluginManager(visible.has('plugins'));
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());

  // A new requested section scrolls the open sheet to it; the first one is shown on opening.
  const [reveal, setReveal] = useState({ section: initialSection, token: 0 });
  useEffect(() => {
    setReveal(current => (current.section === initialSection ? current : { section: initialSection, token: current.token + 1 }));
  }, [initialSection]);

  const [reported, setReported] = useState<Record<string, NativeSettingsRow[]>>({});
  const handlers = useRef(new Map<string, RowsHandler>());
  const registry = useMemo<RowsRegistry>(() => ({
    set: (key, rows) => setReported(current => ({ ...current, [key]: rows })),
    remove: key => setReported(current => {
      if (!(key in current)) return current;
      const next = { ...current };
      delete next[key];
      return next;
    }),
    handle: (key, handler) => {
      if (handler) handlers.current.set(key, handler);
      else handlers.current.delete(key);
    },
  }), []);

  const desktop = manager.api;
  const setEnabled = (plugin: MusicPluginInfo, enabled: boolean) => {
    void manager.change(`enable:${plugin.id}`, () => desktop!.musicPluginSetEnabled!(plugin.id, enabled));
  };
  const requestUninstall = (plugin: MusicPluginInfo) => {
    manager.setFailure(null);
    manager.setUninstalling(plugin);
  };
  const updatePlugin = (id: string) => {
    void manager.change(`update:${id}`, () => desktop!.pluginUpdate!(id));
  };
  const setUpdateSource = (id: string, source: PluginUpdateSource | null) => {
    void manager.change(`source:${id}`, async () => {
      manager.setUpdates(await desktop!.pluginSetUpdateSource!(id, source));
      manager.setUpdates(await desktop!.pluginCheckUpdates!());
    });
  };
  const toggleCard = useCallback((id: string) => {
    setExpanded(current => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }, []);

  const updater = general.updater;
  const blocks: Record<SettingsSectionId, NativeSettingsBlock[]> = {
    general: generalBlocks({
      language: i18n.language,
      languages: LANGUAGE_OPTIONS.map(option => ({ value: option.value, title: option.nativeLabel })),
      downloadPath: download.path,
      downloadRevision,
      appVersion: general.appVersion,
      updater: {
        visible: general.canUpdate && !!updater,
        status: general.updateStatus,
        error: updater?.status === 'error' ? updater.message : '',
        downloaded: updater?.status === 'downloaded',
        busy: general.updateBusy,
      },
    }, t),
    plugins: pluginsBlocks({
      available: !!desktop,
      busy: !!manager.busy,
      installError: manager.installError ?? '',
      hasPlugins: manager.plugins.length > 0,
      checkingUpdates: manager.updates.some(info => info.status === 'checking' || info.status === 'updating'),
      listError: manager.errorFor('updates') ?? (manager.loadError || manager.updateError || ''),
      cards: manager.plugins
        .map(plugin => ({ id: plugin.id, rows: PLUGIN_CARD_PARTS.flatMap(part => reported[`plugin:${plugin.id}:${part}`] ?? []) }))
        .filter(entry => entry.rows.length > 0),
      catalog: manager.notInstalled.map(item => ({
        id: item.id,
        name: item.name,
        kind: t(item.kind === 'lyrics.translation' ? 'musicPlugins.kindTranslation' : 'musicPlugins.kindMusicSource'),
        version: item.version ? t('musicPlugins.officialVersion', { version: item.version }) : t('musicPlugins.unreleased'),
        description: item.description ?? '',
        error: manager.errorFor(downloadKey(item.id)) ?? '',
        downloading: manager.busy === downloadKey(item.id),
        enabled: !manager.busy && !!item.version && !!desktop,
      })),
      loadingCatalog: manager.loadingCatalog,
      catalogError: manager.catalogError,
      directory: manager.directory,
      directoryError: manager.openDirectoryError ?? '',
    }, t),
    cloud: cloudBlocks({
      serverUrl: webdav.serverUrl,
      username: webdav.username,
      password: webdav.password,
      revision: 0,
      isDirty: webdav.isDirty,
      isTesting: webdav.isTesting,
      isSaving: webdav.isSaving,
      message: webdav.message,
    }, t),
    focus: focusBlocks({
      amllBackground: focus.amllBackground,
      opacity: focus.opacity,
      blurRadius: focus.blurRadius,
      fontSize: focus.fontSize,
      lineSpacing: focus.lineSpacing,
      canPreviewWelcome: true,
    }, t),
    shortcuts: shortcutsBlocks({
      shortcuts: editor.shortcuts,
      list: editor.allShortcuts,
      editingAction: editor.editingAction,
      conflict: editor.conflict,
      displayKey: editor.displayKey,
    }, t),
  };

  const uninstalling = manager.uninstalling;
  const dialog: NativeSettingsDialog | null = uninstalling ? {
    title: t('musicPlugins.uninstallTitle', { name: uninstalling.name }),
    message: t('musicPlugins.uninstallMessage'),
    error: manager.errorFor(manager.uninstallKey) ?? '',
    confirmTitle: t('musicPlugins.uninstall'),
    cancelTitle: t('common.cancel'),
    destructive: true,
    busy: !!manager.busy,
  } : editor.showResetConfirm ? {
    title: t('settings.shortcuts.resetAllConfirm'),
    message: t('settings.shortcuts.resetAllDesc'),
    error: '',
    confirmTitle: t('settings.shortcuts.resetAll'),
    cancelTitle: t('common.cancel'),
    destructive: false,
    busy: false,
  } : null;

  const state: NativeSettingsState = {
    open: !prewarm,
    darkMode,
    title: t('settings.title'),
    closeLabel: t('common.close'),
    unsavedLabel: t('settingsDialog.unsaved'),
    reveal,
    sections: SETTINGS_SECTIONS.map(entry => ({
      id: entry.id,
      title: t(entry.titleKey),
      navTitle: t(entry.navKey),
      symbol: SECTION_SYMBOLS[entry.id],
      // The WebDAV draft is kept while the sheet is open; the dot shows it is waiting.
      unsaved: entry.id === 'cloud' && webdav.isDirty,
      blocks: blocks[entry.id],
    })),
    dialog,
  };

  const handleDialog = (confirmed: boolean) => {
    if (uninstalling) {
      if (confirmed) void manager.confirmUninstall();
      else if (!manager.busy) { manager.setUninstalling(null); manager.setFailure(null); }
    } else if (editor.showResetConfirm) {
      if (confirmed) editor.handleResetAll();
      else editor.setShowResetConfirm(false);
    }
  };

  const handleShortcutRow = (action: NativeSettingsAction): boolean => {
    if (!action.id.startsWith(SHORTCUT_PREFIX)) return false;
    const [name, part] = action.id.slice(SHORTCUT_PREFIX.length).split(':') as [ShortcutAction, string | undefined];
    if (part === 'reset') editor.handleReset(name);
    else if (part === 'replace' && editor.conflict) editor.replace(name, editor.conflict.key);
    return true;
  };

  const handleAction = (action: NativeSettingsAction) => {
    switch (action.type) {
      case 'close': onClose(); return;
      case 'visible':
        if (SECTION_IDS.has(action.id)) setVisible(current => (current.has(action.id) ? current : new Set([...current, action.id])));
        return;
      case 'shortcut': {
        const event = dispatchForwardedShortcut(action.text, action.value);
        if (event && (shortcutManager.matchesShortcut('cyclePlaylists', event, true)
          || shortcutManager.matchesShortcut('toggleFocusMode', event))) onClose();
        return;
      }
      case 'dialog': handleDialog(action.text === 'confirm'); return;
      case 'record':
        editor.cancelRecording();
        editor.setEditingAction(action.id.slice(SHORTCUT_PREFIX.length) as ShortcutAction);
        return;
      case 'record-key': editor.handleKey(action.id.slice(SHORTCUT_PREFIX.length) as ShortcutAction, recordedKey(action)); return;
      case 'record-cancel': editor.cancelRecording(); return;
      default: break;
    }
    const handler = findRowsHandler(handlers.current, action.id);
    if (handler) { handler(action); return; }
    if (handleShortcutRow(action)) return;
    switch (action.id) {
      case 'general:language':
        if (action.type === 'popup') void i18n.changeLanguage(action.text as Language);
        return;
      case 'general:download-path':
        if (action.type === 'field') download.setPath(action.text);
        else if (action.type === 'commit') download.store(action.text.trim());
        return;
      case 'general:choose-folder':
        void download.chooseFolder().then(() => setDownloadRevision(value => value + 1));
        return;
      case 'general:check': general.checkForUpdates(); return;
      case 'general:restart': general.restartToUpdate(); return;
      case 'plugins:install': void manager.change('install', () => desktop!.musicPluginInstall!()); return;
      case 'plugins:check-updates':
        void manager.change('updates', async () => { manager.setUpdates(await desktop!.pluginCheckUpdates!()); });
        return;
      case 'plugins:refresh': manager.setReload(value => value + 1); return;
      case 'plugins:open-directory': void manager.change('directory', () => desktop!.musicPluginOpenDirectory!()); return;
      case 'cloud:url': if (action.type === 'field') webdav.setServerUrl(action.text); return;
      case 'cloud:username': if (action.type === 'field') webdav.setUsername(action.text); return;
      case 'cloud:password': if (action.type === 'field') webdav.setPassword(action.text); return;
      case 'cloud:save': void webdav.handleSave(); return;
      case 'focus:amll': void settingsManager.setFocusAmllBackgroundEnabled(action.value === 1); return;
      case 'focus:opacity': focus.changeOpacity(action.value); return;
      case 'focus:blur': void settingsManager.setFocusBgBlurRadius(action.value); return;
      case 'focus:font-size': void settingsManager.setFocusLyricsFontSize(action.value); return;
      case 'focus:line-spacing': void settingsManager.setFocusLyricLineSpacing(action.value); return;
      case 'focus:welcome': onPreviewWelcome(); return;
      case 'shortcuts:reset-all': editor.setShowResetConfirm(true); return;
      default:
        if (action.id.startsWith('catalog:') && action.id.endsWith(':download')) {
          const id = action.id.slice('catalog:'.length, -':download'.length);
          void manager.change(downloadKey(id), () => desktop!.musicPluginDownload!(id));
        }
    }
  };

  const prewarmedRef = useRef(onPrewarmed);
  prewarmedRef.current = onPrewarmed;
  const synced = useCallback(() => {
    sheetBuilt = true;
    prewarmedRef.current?.();
  }, []);
  const status = useNativeSettingsSurface(api, state, handleAction, synced);
  useEffect(() => { if (status === 'failed') onFailed(); }, [onFailed, status]);
  useEffect(() => {
    if (prewarm) return;
    // The sheet's controls take the keyboard, so the page sees `blur` while the window stays key.
    setNativeSettingsOwnsKeyboard(true);
    return () => setNativeSettingsOwnsKeyboard(false);
  }, [prewarm]);

  return (
    <RowsRegistryContext.Provider value={registry}>
      {/* AppKit draws the sheet; the web layer dims the wall and closes on an outside click. */}
      {!prewarm && <div className="settings-sheet-backdrop" data-native-settings="true" data-controlbar-passthrough onMouseDown={onClose} />}
      {manager.plugins.map(plugin => (
        <NativePluginCard key={plugin.id} plugin={plugin} update={manager.updates.find(info => info.id === plugin.id)}
          busy={manager.busy} available={!!desktop} error={manager.errorFor(`enable:${plugin.id}`, `source:${plugin.id}`)}
          expanded={expanded.has(plugin.id)} onToggle={toggleCard} onSetEnabled={setEnabled} onUninstall={requestUninstall}
          onUpdate={updatePlugin} onSetUpdateSource={setUpdateSource} />
      ))}
    </RowsRegistryContext.Provider>
  );
}
