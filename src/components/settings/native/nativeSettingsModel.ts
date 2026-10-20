import type { TFunction } from 'i18next';
import type { MusicPluginInfo } from '@/shared/musicPlugin';
import type { ConfigurationField } from '@/shared/plugin';
import type { PluginUpdateChannel, PluginUpdateInfo, PluginUpdateSource } from '@/shared/pluginUpdate';
import type { ShortcutAction, ShortcutConfig } from '@/services/shortcuts';
import type { SettingsSectionId } from '@/types/settingsPanel';
import {
  NATIVE_SETTINGS_LIMITS,
  type NativeSettingsBlock,
  type NativeSettingsControl,
  type NativeSettingsRow,
  type NativeSettingsTone,
} from '@/types/nativeSettings';
import type { SourceLogin } from '../hooks/useSourceLogin';
import { qrSignedIn, qrStatusText } from '../sections/SourceLoginSection';
import { formatBytes } from '../sections/PluginConfiguration';
import { PLUGIN_REPOSITORY_URL } from '../sections/MusicPluginManager';

/** SF Symbols of the navigation items, twins of the web sheet's Material Symbols. */
export const SECTION_SYMBOLS: Readonly<Record<SettingsSectionId, string>> = {
  general: 'slider.horizontal.3',
  plugins: 'puzzlepiece.extension',
  cloud: 'cloud',
  focus: 'flask',
  shortcuts: 'keyboard',
};

type ConfigurationValue = string | boolean | number;

export const clip = (text: string | undefined, max: number = NATIVE_SETTINGS_LIMITS.text) => (text ?? '').slice(0, max);

export function row(id: string, layout: NativeSettingsRow['layout'], fields: Partial<Omit<NativeSettingsRow, 'id' | 'layout'>> = {}): NativeSettingsRow {
  return {
    id,
    layout,
    title: clip(fields.title),
    detail: clip(fields.detail),
    footnote: clip(fields.footnote),
    tone: fields.tone ?? 'default',
    detailTone: fields.detailTone ?? 'secondary',
    controls: (fields.controls ?? []).slice(0, NATIVE_SETTINGS_LIMITS.controls),
  };
}

export const message = (id: string, text: string, tone: 'success' | 'error') => row(id, 'message', { title: text, tone });
export const note = (id: string, text: string, tone: NativeSettingsTone = 'secondary') => row(id, 'note', { title: text, tone });

export function card(id: string, rows: NativeSettingsRow[], heading = '', headingControls: NativeSettingsControl[] = []): NativeSettingsBlock {
  return { id, kind: 'card', heading: clip(heading), headingControls, rows: rows.slice(0, NATIVE_SETTINGS_LIMITS.rows) };
}

export function plain(id: string, rows: NativeSettingsRow[], heading = '', headingControls: NativeSettingsControl[] = []): NativeSettingsBlock {
  return { id, kind: 'plain', heading: clip(heading), headingControls, rows: rows.slice(0, NATIVE_SETTINGS_LIMITS.rows) };
}

interface ButtonOptions { symbol?: string; style?: 'primary' | 'secondary' | 'plain' | 'destructive'; enabled?: boolean; label?: string }
export function button(id: string, title: string, options: ButtonOptions = {}): NativeSettingsControl {
  return { type: 'button', id, title: clip(title), symbol: options.symbol ?? '', style: options.style ?? 'secondary', enabled: options.enabled ?? true, label: clip(options.label ?? title) };
}

interface FieldOptions { revision?: number; placeholder?: string; secure?: boolean; lines?: number; enabled?: boolean; label?: string }
export function field(id: string, value: string, options: FieldOptions = {}): NativeSettingsControl {
  return {
    type: 'field', id, value: clip(value, NATIVE_SETTINGS_LIMITS.field), revision: options.revision ?? 0,
    placeholder: clip(options.placeholder), secure: options.secure ?? false, lines: options.lines ?? 1,
    enabled: options.enabled ?? true, label: clip(options.label),
  };
}

export function popup(id: string, value: string, options: { value: string; title: string }[], extra: { enabled?: boolean; label: string }): NativeSettingsControl {
  return {
    type: 'popup', id, value: clip(value), enabled: extra.enabled ?? true, label: clip(extra.label),
    options: options.slice(0, NATIVE_SETTINGS_LIMITS.options).map(option => ({ value: clip(option.value), title: clip(option.title) })),
  };
}

export function toggle(id: string, on: boolean, extra: { enabled?: boolean; label: string }): NativeSettingsControl {
  return { type: 'switch', id, on, enabled: extra.enabled ?? true, label: clip(extra.label) };
}

const SPINNER: NativeSettingsControl = { type: 'spinner' };

// MARK: General

export interface GeneralModel {
  language: string;
  languages: { value: string; title: string }[];
  downloadPath: string;
  downloadRevision: number;
  appVersion: string;
  updater: { visible: boolean; status: string; error: string; downloaded: boolean; busy: boolean };
}

export function generalBlocks(model: GeneralModel, t: TFunction): NativeSettingsBlock[] {
  const rows = [
    row('general:language', 'inline', {
      title: t('settings.language'),
      controls: [popup('general:language', model.language, model.languages, { label: t('settings.language') })],
    }),
    row('general:download', 'stacked', {
      title: t('settingsDialog.savePath'),
      footnote: t('settingsDialog.tip'),
      controls: [
        field('general:download-path', model.downloadPath, {
          revision: model.downloadRevision, placeholder: t('settingsDialog.downloadFolderPath'), label: t('settingsDialog.savePath'),
        }),
        button('general:choose-folder', '', { symbol: 'folder', label: t('settingsDialog.chooseDownloadFolder') }),
      ],
    }),
    row('general:about', 'inline', {
      title: t('settings.about'),
      controls: [{ type: 'label', text: `LyricsAdapter v${model.appVersion || '…'}`, tone: 'muted' }],
    }),
  ];
  if (model.updater.visible) {
    rows.push(row('general:updater', 'inline', {
      title: model.updater.status,
      detail: model.updater.error,
      tone: 'secondary',
      controls: [model.updater.downloaded
        ? button('general:restart', t('updater.restart'), { style: 'primary' })
        : button('general:check', t('updater.check'), { enabled: !model.updater.busy })],
    }));
  }
  return [card('general', rows)];
}

// MARK: Plugins

export interface CatalogItemModel {
  id: string;
  name: string;
  kind: string;
  version: string;
  description: string;
  error: string;
  downloading: boolean;
  enabled: boolean;
}

export interface PluginsModel {
  available: boolean;
  busy: boolean;
  installError: string;
  hasPlugins: boolean;
  checkingUpdates: boolean;
  listError: string;
  /** Rows of each installed plugin's card, in list order. */
  cards: { id: string; rows: NativeSettingsRow[] }[];
  catalog: CatalogItemModel[];
  loadingCatalog: boolean;
  catalogError: string;
  directory: string;
  directoryError: string;
}

export function pluginsBlocks(model: PluginsModel, t: TFunction): NativeSettingsBlock[] {
  const blocks: NativeSettingsBlock[] = [
    plain('plugins:intro', [
      row('plugins:intro', 'inline', {
        title: t('musicPlugins.description'),
        tone: 'secondary',
        controls: [button('plugins:install', t('musicPlugins.install'), { enabled: !model.busy && model.available })],
      }),
      ...(model.installError ? [message('plugins:install-error', model.installError, 'error')] : []),
    ]),
    plain('plugins:installed', [
      ...(model.listError ? [message('plugins:list-error', model.listError, 'error')] : []),
      ...(!model.hasPlugins ? [note('plugins:empty', t('musicPlugins.empty'))] : []),
    ], t('musicPlugins.installedTitle'), model.hasPlugins
      ? [button('plugins:check-updates', t('pluginUpdates.check'), { enabled: !model.busy && model.available && !model.checkingUpdates })]
      : []),
    ...model.cards.map(entry => card(`plugin:${entry.id}`, entry.rows)),
    plain('plugins:catalog', [
      ...(model.loadingCatalog ? [note('plugins:catalog-loading', t('musicPlugins.loading'))] : []),
      ...(!model.loadingCatalog && model.catalogError ? [message('plugins:catalog-error', model.catalogError, 'error')] : []),
      ...(!model.loadingCatalog && !model.catalogError && !model.catalog.length ? [note('plugins:catalog-empty', t('musicPlugins.allInstalled'))] : []),
    ], t('musicPlugins.available'), [
      button('plugins:refresh', t('musicPlugins.refresh'), { enabled: !model.loadingCatalog && !model.busy && model.available }),
    ]),
    ...model.catalog.map(item => card(`catalog:${item.id}`, [
      row(`catalog:${item.id}`, 'inline', {
        title: item.name,
        detail: `${item.kind} · ${item.version}`,
        footnote: item.description,
        controls: [button(`catalog:${item.id}:download`, item.downloading ? t('musicPlugins.working') : t('musicPlugins.download'), { enabled: item.enabled })],
      }),
      ...(item.error ? [message(`catalog:${item.id}:error`, item.error, 'error')] : []),
    ])),
    plain('plugins:directory', [
      note('plugins:directory-label', t('musicPlugins.directory')),
      note('plugins:directory-path', model.directory || t('musicPlugins.desktopOnly')),
      row('plugins:directory-actions', 'actions', {
        controls: [
          button('plugins:open-directory', t('musicPlugins.openDirectory'), { enabled: !model.busy && !!model.directory }),
          { type: 'link', id: 'plugins:repository', title: clip(t('musicPlugins.repository')), url: PLUGIN_REPOSITORY_URL },
        ],
      }),
      ...(model.directoryError ? [message('plugins:directory-error', model.directoryError, 'error')] : []),
    ]),
  ];
  return blocks;
}

export interface PluginHeaderModel {
  plugin: MusicPluginInfo;
  update: PluginUpdateInfo | undefined;
  busy: boolean;
  available: boolean;
  error: string;
  expanded: boolean;
  signedIn: boolean;
  capabilities: { isSource: boolean; signsIn: boolean; configurable: boolean; translates: boolean };
}

/** The card's one-line summary; the switch says whether the plugin is on. */
export function pluginHeaderRows(model: PluginHeaderModel, t: TFunction): NativeSettingsRow[] {
  const { plugin, update, capabilities } = model;
  const prefix = `plugin:${plugin.id}:header`;
  const summary: string[] = [];
  if (!plugin.enabled) summary.push(t('musicPlugins.disabled'));
  if (capabilities.signsIn) summary.push(t(model.signedIn ? 'musicPlugins.signedIn' : 'musicPlugins.signedOut'));
  if (update?.status === 'available') summary.push(t('musicPlugins.updateAvailable', { version: update.targetVersion }));
  const controls: NativeSettingsControl[] = [];
  if (plugin.origin === 'installed') {
    controls.push(button(`${prefix}:uninstall`, t('musicPlugins.uninstall'), { enabled: !model.busy && model.available }));
  }
  if (capabilities.isSource || capabilities.configurable || capabilities.translates || update) {
    controls.push({
      type: 'disclosure', id: `${prefix}:disclosure`, title: clip(t('musicPlugins.settings')), expanded: model.expanded,
      label: clip(t('musicPlugins.settingsFor', { name: plugin.name })),
    });
  }
  controls.push(toggle(`${prefix}:enable`, plugin.enabled, {
    enabled: !model.busy && model.available, label: t('musicPlugins.enablePlugin', { name: plugin.name }),
  }));
  return [
    row(prefix, 'inline', { title: `${plugin.name} · ${plugin.version}`, detail: summary.join(' · '), controls }),
    ...(plugin.restartRequired ? [note(`${prefix}:restart`, t('musicPlugins.restart'))] : []),
    ...(plugin.error ? [message(`${prefix}:plugin-error`, plugin.error, 'error')] : []),
    ...(model.error ? [message(`${prefix}:error`, model.error, 'error')] : []),
  ];
}

export function sourceLoginRows(prefix: string, state: SourceLogin, cookieRevision: number, t: TFunction): NativeSettingsRow[] {
  const rows: NativeSettingsRow[] = [];
  const signedIn = qrSignedIn(state);
  if (state.qrSupported) {
    const controls: NativeSettingsControl[] = state.qrState === 'loading' ? [SPINNER] : [];
    if (signedIn) {
      controls.push(button(`${prefix}:logout`, t('settingsDialog.qrLogout')), button(`${prefix}:qr`, t('settingsDialog.qrReLogin')));
    } else if (state.qrState !== 'loading') {
      controls.push(button(`${prefix}:qr`, t('settingsDialog.qrRefresh')));
    }
    rows.push(row(`${prefix}:qr`, 'inline', {
      title: t('settingsDialog.qrTitle'),
      detail: qrStatusText(state, t),
      detailTone: signedIn ? 'secondary' : state.qrState === 'confirming' ? 'accent' : 'muted',
      controls,
    }));
    if (!signedIn && state.qrImage) {
      rows.push(row(`${prefix}:qr-image`, 'center', {
        controls: [{ type: 'image', id: `${prefix}:qr-image`, source: clip(state.qrImage, NATIVE_SETTINGS_LIMITS.image), size: 128, label: clip(t('settingsDialog.qrTitle')) }],
      }));
    }
  }
  const cookieLabel = state.login === 'netease-qr' ? t('settingsDialog.neteaseCookieLabel') : t('settingsDialog.cookie');
  rows.push(row(`${prefix}:cookie`, 'stacked', {
    title: cookieLabel,
    detail: state.qrSupported ? '' : t(state.login === 'cookie' ? 'settingsDialog.cookieLoginHint' : 'settingsDialog.noLoginHint'),
    controls: [field(`${prefix}:cookie`, state.cookie, {
      revision: cookieRevision, placeholder: t('settingsDialog.pasteCookie'), lines: 3, enabled: !state.isSaving, label: cookieLabel,
    })],
  }));
  rows.push(row(`${prefix}:cookie-save`, 'inline', {
    controls: [
      ...(state.cookieDirty ? [{ type: 'label', text: clip(t('settingsDialog.unsaved')), tone: 'muted' } as NativeSettingsControl] : []),
      ...(state.isSaving ? [SPINNER] : []),
      button(`${prefix}:cookie-save`, state.isSaving ? t('settingsDialog.saving') : t('settingsDialog.cookieSave'), {
        style: 'primary', enabled: !state.isSaving && (state.cookieDirty || !!state.cookie.trim()),
      }),
    ],
  }));
  if (state.message) rows.push(message(`${prefix}:message`, state.message.text, state.message.tone));
  return rows;
}

export interface TranslationModel {
  language: string;
  languages: { value: string; title: string }[];
  enabled: boolean;
  error: string;
}

export function translationRows(prefix: string, model: TranslationModel, t: TFunction): NativeSettingsRow[] {
  return [
    row(`${prefix}:language`, 'inline', {
      title: t('plugins.translationLanguage'),
      controls: [popup(`${prefix}:language`, model.language, model.languages, { enabled: model.enabled, label: t('plugins.translationLanguage') })],
    }),
    ...(model.error ? [message(`${prefix}:error`, model.error, 'error')] : []),
  ];
}

export interface ConfigurationModel {
  fields: [string, ConfigurationField][];
  values: Record<string, ConfigurationValue>;
  /** Text being typed into a field, until it is applied. */
  drafts: Record<string, string>;
  secretDrafts: Record<string, string>;
  revisions: Record<string, number>;
  configuredSecrets: string[];
  busy: boolean;
  cacheEntries: number;
  cacheBytes: number;
  error: string;
}

/** Configuration keys are plugin-chosen, so they live under their own segment. */
export const configurationFieldId = (prefix: string, key: string) => `${prefix}:field:${key}`;

export function configurationRows(prefix: string, model: ConfigurationModel, t: TFunction): NativeSettingsRow[] {
  const rows: NativeSettingsRow[] = model.fields.map(([key, definition]) => {
    const id = configurationFieldId(prefix, key);
    const value = model.values[key] ?? definition.default;
    const footnote = definition.description ?? '';
    if (definition.format === 'secret') {
      const configured = model.configuredSecrets.includes(key);
      const draft = model.secretDrafts[key] ?? '';
      return row(id, 'stacked', {
        title: definition.title,
        footnote,
        controls: [
          field(id, draft, {
            secure: true, revision: model.revisions[id] ?? 0, label: definition.title,
            placeholder: t(configured ? 'plugins.secretConfigured' : 'plugins.secretEmpty'),
          }),
          button(`${id}:save`, t('settingsDialog.save'), { enabled: !model.busy && !!draft, label: t('plugins.saveSecretLabel', { name: definition.title }) }),
          ...(configured ? [button(`${id}:clear`, t('plugins.clearSecret'), { enabled: !model.busy, label: t('plugins.clearSecretLabel', { name: definition.title }) })] : []),
        ],
      });
    }
    if (definition.enum) {
      return row(id, 'inline', {
        title: definition.title,
        footnote,
        controls: [popup(id, String(value), definition.enum.map(option => ({ value: String(option), title: String(option) })), { label: definition.title })],
      });
    }
    if (definition.type === 'boolean') {
      return row(id, 'inline', { title: definition.title, footnote, controls: [toggle(id, Boolean(value), { label: definition.title })] });
    }
    return row(id, 'stacked', {
      title: definition.title,
      footnote,
      controls: [field(id, model.drafts[key] ?? String(value), { revision: model.revisions[id] ?? 0, label: definition.title })],
    });
  });
  rows.push(row(`${prefix}:cache`, 'inline', {
    title: t('plugins.cacheSummary', { count: model.cacheEntries, size: formatBytes(model.cacheBytes) }),
    tone: 'secondary',
    controls: [button(`${prefix}:cache`, t('plugins.clearCache'), { enabled: !model.busy && !!model.cacheEntries })],
  }));
  if (model.error) rows.push(message(`${prefix}:error`, model.error, 'error'));
  return rows;
}

export interface UpdateModel {
  info: PluginUpdateInfo;
  busy: boolean;
  kind: PluginUpdateSource['kind'] | 'none';
  value: string;
  valueRevision: number;
  channel: PluginUpdateChannel;
  official: boolean;
}

export function updateRows(prefix: string, model: UpdateModel, t: TFunction): NativeSettingsRow[] {
  const { info } = model;
  const statusControls: NativeSettingsControl[] = [];
  if (info.status === 'available') statusControls.push(button(`${prefix}:apply`, t('pluginUpdates.update'), { enabled: !model.busy }));
  if (info.status === 'error' && info.targetVersion) statusControls.push(button(`${prefix}:apply`, t('pluginUpdates.retry'), { enabled: !model.busy }));
  const rows: NativeSettingsRow[] = [
    row(`${prefix}:status`, 'inline', {
      title: info.status === 'available'
        ? t('pluginUpdates.available', { current: info.currentVersion, next: info.targetVersion })
        : t(`pluginUpdates.${info.status}`),
      tone: 'secondary',
      controls: statusControls,
    }),
  ];
  if (info.status === 'available' && info.latestVersion !== info.targetVersion) {
    rows.push(note(`${prefix}:incompatible`, t('pluginUpdates.newerIncompatible', { version: info.latestVersion })));
  }
  if (info.notes) rows.push(note(`${prefix}:notes`, info.notes));
  if (info.error) rows.push(message(`${prefix}:error`, info.error, 'error'));
  rows.push(row(`${prefix}:source`, 'subheading', { title: t('pluginUpdates.source') }));
  const kinds = [
    { value: 'none', title: t('pluginUpdates.none') },
    { value: 'github', title: 'GitHub Releases' },
    { value: 'manifest', title: t('pluginUpdates.feed') },
    ...(model.official ? [{ value: 'official', title: t('pluginUpdates.official') }] : []),
  ];
  rows.push(row(`${prefix}:kind`, 'inline', {
    title: t('pluginUpdates.sourceType'),
    controls: [popup(`${prefix}:kind`, model.kind, kinds, { enabled: !model.busy, label: t('pluginUpdates.sourceType') })],
  }));
  const needsValue = model.kind === 'github' || model.kind === 'manifest';
  if (needsValue) {
    const label = t(model.kind === 'github' ? 'pluginUpdates.repository' : 'pluginUpdates.feedUrl');
    rows.push(row(`${prefix}:value`, 'stacked', {
      title: label,
      controls: [field(`${prefix}:value`, model.value, {
        revision: model.valueRevision, enabled: !model.busy, label,
        placeholder: model.kind === 'github' ? 'owner/repository' : 'https://example.com/plugins.update.json',
      })],
    }));
    rows.push(row(`${prefix}:channel`, 'inline', {
      title: t('pluginUpdates.channel'),
      controls: [popup(`${prefix}:channel`, model.channel, [
        { value: 'stable', title: t('pluginUpdates.stable') },
        { value: 'prerelease', title: t('pluginUpdates.prerelease') },
      ], { enabled: !model.busy, label: t('pluginUpdates.channel') })],
    }));
    rows.push(note(`${prefix}:hint`, t('pluginUpdates.sourceHint')));
  }
  rows.push(row(`${prefix}:save`, 'actions', {
    controls: [button(`${prefix}:save`, t('pluginUpdates.saveSource'), { enabled: !model.busy && !(needsValue && !model.value.trim()) })],
  }));
  return rows;
}

// MARK: Cloud

export interface CloudModel {
  serverUrl: string;
  username: string;
  password: string;
  revision: number;
  isDirty: boolean;
  isTesting: boolean;
  isSaving: boolean;
  message: { text: string; tone: 'success' | 'error' } | null;
}

export function cloudBlocks(model: CloudModel, t: TFunction): NativeSettingsBlock[] {
  const working = model.isTesting || model.isSaving;
  const rows = [
    row('cloud:url', 'stacked', {
      controls: [field('cloud:url', model.serverUrl, { revision: model.revision, placeholder: 'https://webdav.123pan.cn/webdav', label: t('settingsDialog.webdavTitle') })],
    }),
    row('cloud:username', 'stacked', {
      controls: [field('cloud:username', model.username, { revision: model.revision, placeholder: t('settingsDialog.webdavUsername'), label: t('settingsDialog.webdavUsername') })],
    }),
    row('cloud:password', 'stacked', {
      controls: [field('cloud:password', model.password, { revision: model.revision, secure: true, placeholder: t('settingsDialog.webdavPassword'), label: t('settingsDialog.webdavPassword') })],
    }),
    row('cloud:save', 'inline', {
      controls: [
        ...(model.isDirty ? [{ type: 'label', text: clip(t('settingsDialog.unsaved')), tone: 'muted' } as NativeSettingsControl] : []),
        ...(working ? [SPINNER] : []),
        button('cloud:save', working ? t(model.isTesting ? 'settingsDialog.webdavTesting' : 'settingsDialog.saving') : t('settingsDialog.webdavConnectAndSave'), {
          style: 'primary', enabled: !working,
        }),
      ],
    }),
    ...(model.message ? [message('cloud:message', model.message.text, model.message.tone)] : []),
  ];
  return [card('cloud', rows)];
}

// MARK: Experimental (Focus Mode)

export interface FocusModel {
  amllBackground: boolean;
  opacity: number;
  blurRadius: number;
  fontSize: number;
  lineSpacing: number;
  canPreviewWelcome: boolean;
}

function slider(id: string, title: string, value: number, range: [number, number, number], display: string): NativeSettingsRow {
  const [min, max, step] = range;
  return row(id, 'inline', { title, controls: [{ type: 'slider', id, value, min, max, step, display: clip(display), label: clip(title) }] });
}

export function focusBlocks(model: FocusModel, t: TFunction): NativeSettingsBlock[] {
  const rows = [
    row('focus:amll', 'inline', {
      title: t('settings.focusAmllBackground'),
      detail: t('settings.focusAmllBackgroundDesc'),
      controls: [toggle('focus:amll', model.amllBackground, { label: t('settings.focusAmllBackground') })],
    }),
    slider('focus:opacity', t('settings.bgBlurTrans'), model.opacity, [0, 1, 0.01], model.opacity.toFixed(2)),
    // The mesh gradient has no blur radius; it only applies to the classic cover.
    ...(!model.amllBackground ? [slider('focus:blur', t('settings.focusBgBlurRadius'), model.blurRadius, [40, 80, 1], `${model.blurRadius}px`)] : []),
    slider('focus:font-size', t('settings.focusLyricsFontSize'), model.fontSize, [24, 40, 1], `${model.fontSize}px`),
    slider('focus:line-spacing', t('settings.focusLyricLineSpacing'), model.lineSpacing, [12, 48, 1], `${model.lineSpacing}px`),
  ];
  const blocks = [card('focus', rows, t('settings.nav.focus'))];
  if (model.canPreviewWelcome) {
    blocks.push(card('focus:welcome', [row('focus:welcome', 'inline', {
      title: t('settings.welcomePreview'),
      detail: t('settings.welcomePreviewDesc'),
      controls: [button('focus:welcome', t('settings.welcomePreviewAction'))],
    })]));
  }
  return blocks;
}

// MARK: Shortcuts

export interface ShortcutsModel {
  shortcuts: Record<ShortcutAction, ShortcutConfig>;
  list: [ShortcutAction, ShortcutConfig][];
  editingAction: ShortcutAction | null;
  conflict: { action: ShortcutAction; key: string } | null;
  displayKey: (key: string) => string;
}

export function shortcutsBlocks(model: ShortcutsModel, t: TFunction): NativeSettingsBlock[] {
  const rows = model.list.flatMap(([action, config]) => {
    const id = `shortcut:${action}`;
    const recording = model.editingAction === action;
    const controls: NativeSettingsControl[] = [{
      type: 'shortcut', id,
      display: clip(config.currentKey ? model.displayKey(config.currentKey) : '-'),
      state: !config.currentKey ? 'unset' : config.currentKey !== config.defaultKey ? 'custom' : 'default',
      recording,
      prompt: clip(t('settings.shortcuts.pressKey')),
      label: clip(t(config.name)),
    }];
    if (config.currentKey !== config.defaultKey || !config.currentKey) {
      controls.push(button(`${id}:reset`, '', {
        style: 'plain',
        symbol: config.currentKey ? 'arrow.counterclockwise' : 'delete.left',
        label: config.currentKey ? t('settings.shortcuts.reset') : t('settings.shortcuts.clear'),
      }));
    }
    const result = [row(id, 'inline', { title: t(config.name), controls })];
    if (recording && model.conflict) {
      result.push(row(`${id}:conflict`, 'inline', {
        title: t('settings.shortcuts.conflictWith', {
          key: model.displayKey(model.conflict.key), name: t(model.shortcuts[model.conflict.action]?.name || ''),
        }),
        detail: t('settings.shortcuts.replaceHint'),
        tone: 'accent',
        detailTone: 'muted',
        controls: [button(`${id}:replace`, t('settings.shortcuts.replace'), { style: 'primary' })],
      }));
    }
    return result;
  });
  return [
    plain('shortcuts:legend', [row('shortcuts:legend', 'inline', {
      title: t('settings.shortcuts.legend'),
      tone: 'muted',
      controls: [button('shortcuts:reset-all', t('settings.shortcuts.resetAll'))],
    })]),
    card('shortcuts', rows),
  ];
}
