import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { MusicPluginInfo } from '@/shared/musicPlugin';
import type { ConfigurationField } from '@/shared/plugin';
import { isOfficialMusicSource, type PluginUpdateChannel, type PluginUpdateInfo, type PluginUpdateSource } from '@/shared/pluginUpdate';
import { languageDisplayName, translationLanguages } from '@/services/pluginTranslation';
import { useSourceLogin, useSourceSignedIn } from '../hooks/useSourceLogin';
import { pluginCardCapabilities } from '../sections/InstalledPluginCard';
import { usePluginConfiguration } from '../sections/PluginConfiguration';
import { usePluginUpdateSource } from '../sections/PluginUpdateControls';
import { useTranslationLanguage } from '../sections/TranslationLanguageField';
import { configurationFieldId, configurationRows, pluginHeaderRows, sourceLoginRows, translationRows, updateRows } from './nativeSettingsModel';
import { useReportedRows } from './useReportedRows';

/** The parts of a card, in the order the web card shows them. */
export const PLUGIN_CARD_PARTS = ['header', 'login', 'translation', 'config', 'update'] as const;

type ConfigurationValue = string | boolean | number;

interface NativePluginCardProps {
  plugin: MusicPluginInfo;
  update: PluginUpdateInfo | undefined;
  /** The running operation, if any; every action waits for it. */
  busy: string | null;
  available: boolean;
  /** Why the last enable or update-source change for this plugin failed. */
  error: string | undefined;
  expanded: boolean;
  onToggle: (id: string) => void;
  onSetEnabled: (plugin: MusicPluginInfo, enabled: boolean) => void;
  onUninstall: (plugin: MusicPluginInfo) => void;
  onUpdate: (id: string) => void;
  onSetUpdateSource: (id: string, source: PluginUpdateSource | null) => void;
}

/** Reports a source's sign-in state for the card's summary line. */
function SignInState({ source, onChange }: { source: string; onChange: (signedIn: boolean) => void }) {
  const signedIn = useSourceSignedIn(source);
  useEffect(() => onChange(signedIn), [onChange, signedIn]);
  return null;
}

/**
 * One installed plugin on the native sheet: the one-line card, and its settings while it is
 * expanded. Like the web card, each part mounts only while shown.
 */
export default function NativePluginCard(props: NativePluginCardProps) {
  const { t } = useTranslation();
  const { plugin, update, expanded } = props;
  const capabilities = pluginCardCapabilities(plugin);
  const [signedIn, setSignedIn] = useState(false);
  const prefix = `plugin:${plugin.id}`;
  useReportedRows(`${prefix}:header`, pluginHeaderRows({
    plugin, update, busy: !!props.busy, available: props.available, error: props.error ?? '',
    expanded, signedIn, capabilities,
  }, t), action => {
    if (action.type === 'switch' && action.id === `${prefix}:header:enable`) props.onSetEnabled(plugin, action.value === 1);
    else if (action.id === `${prefix}:header:uninstall`) props.onUninstall(plugin);
    else if (action.id === `${prefix}:header:disclosure`) props.onToggle(plugin.id);
  });
  return <>
    {capabilities.signsIn && <SignInState source={plugin.id} onChange={setSignedIn} />}
    {expanded && capabilities.isSource && <SourceLoginRows source={plugin.id} prefix={`${prefix}:login`} />}
    {expanded && capabilities.translates && <TranslationRows plugin={plugin} prefix={`${prefix}:translation`} />}
    {expanded && capabilities.configurable && <ConfigurationRows plugin={plugin} prefix={`${prefix}:config`} />}
    {expanded && update && <UpdateRows info={update} busy={!!props.busy} prefix={`${prefix}:update`}
      onUpdate={() => props.onUpdate(plugin.id)} onSetSource={source => props.onSetUpdateSource(plugin.id, source)} />}
  </>;
}

/** QR sign-in and the cookie credential; QR polling stops when the card closes. */
function SourceLoginRows({ source, prefix }: { source: string; prefix: string }) {
  const { t } = useTranslation();
  const state = useSourceLogin(source);
  // A cookie the store rewrites (a QR sign-in, a silent refresh) replaces the field
  // even while it is being edited; text typed here never does.
  const typed = useRef<string | null>(null);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (state.cookie !== typed.current) setRevision(value => value + 1);
  }, [state.cookie]);
  useReportedRows(prefix, sourceLoginRows(prefix, state, revision, t), action => {
    if (action.id === `${prefix}:qr`) void state.startQr();
    else if (action.id === `${prefix}:logout`) void state.logout();
    else if (action.id === `${prefix}:cookie` && action.type === 'field') {
      typed.current = action.text;
      state.setCookie(action.text);
    } else if (action.id === `${prefix}:cookie-save`) void state.saveCookie();
  });
  return null;
}

function TranslationRows({ plugin, prefix }: { plugin: MusicPluginInfo; prefix: string }) {
  const { t } = useTranslation();
  const { preference, provider, language, error, change } = useTranslationLanguage(plugin);
  const languages = translationLanguages(provider).map(tag => ({ value: tag, title: languageDisplayName(tag) }));
  useReportedRows(prefix, translationRows(prefix, { language, languages, enabled: preference.loaded, error }, t), action => {
    if (action.type === 'popup' && action.id === `${prefix}:language`) void change(action.text);
  });
  return null;
}

/** Typed text as the field's value; null when a number field does not hold a number. */
function parseValue(definition: ConfigurationField, text: string): ConfigurationValue | null {
  if (definition.type !== 'number') return text;
  const number = Number(text);
  return text.trim() && Number.isFinite(number) ? number : null;
}

/**
 * The plugin's own configuration. As on the web, text applies when the field is left or
 * Enter is pressed and when the card closes; secrets are saved explicitly and never shown.
 */
function ConfigurationRows({ plugin, prefix }: { plugin: MusicPluginInfo; prefix: string }) {
  const { t } = useTranslation();
  const { fields, values, info, error, busy, write, clearCache } = usePluginConfiguration(plugin);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [secretDrafts, setSecretDrafts] = useState<Record<string, string>>({});
  const [revisions, setRevisions] = useState<Record<string, number>>({});
  const bump = (id: string) => setRevisions(current => ({ ...current, [id]: (current[id] ?? 0) + 1 }));
  const without = (key: string) => (current: Record<string, string>) =>
    Object.fromEntries(Object.entries(current).filter(([name]) => name !== key));

  // A newly stored value replaces that field's typed text.
  const previous = useRef(values);
  useEffect(() => {
    const changed = Object.keys({ ...previous.current, ...values }).filter(key => previous.current[key] !== values[key]);
    previous.current = values;
    if (changed.length) setDrafts(current => Object.fromEntries(Object.entries(current).filter(([key]) => !changed.includes(key))));
  }, [values]);

  // Closing the card removes the fields without ending their editing: apply what was typed.
  const latest = useRef({ drafts, values, fields, write });
  latest.current = { drafts, values, fields, write };
  useEffect(() => () => {
    const pending = latest.current;
    for (const [key, text] of Object.entries(pending.drafts)) {
      const definition = pending.fields.find(([name]) => name === key)?.[1];
      if (!definition) continue;
      const next = parseValue(definition, text);
      if (next !== null && next !== (pending.values[key] ?? definition.default)) void pending.write(key, next, false);
    }
  }, []);

  const commitText = (key: string, definition: ConfigurationField, text: string) => {
    const next = parseValue(definition, text);
    if (next === null) {
      setDrafts(without(key));
      bump(configurationFieldId(prefix, key));
    } else if (next !== (values[key] ?? definition.default)) {
      void write(key, next, false);
    }
  };
  const saveSecret = async (key: string) => {
    const draft = secretDrafts[key];
    if (draft && await write(key, draft, false)) {
      setSecretDrafts(without(key));
      bump(configurationFieldId(prefix, key));
    }
  };

  useReportedRows(prefix, configurationRows(prefix, {
    fields, values, drafts, secretDrafts, revisions, configuredSecrets: info.configuredSecrets,
    busy, cacheEntries: info.cacheEntries, cacheBytes: info.cacheBytes, error,
  }, t), action => {
    if (action.id === `${prefix}:cache`) { void clearCache(); return; }
    const entry = fields.find(([key]) => {
      const id = configurationFieldId(prefix, key);
      return action.id === id || action.id.startsWith(`${id}:`);
    });
    if (!entry) return;
    const [key, definition] = entry;
    const id = configurationFieldId(prefix, key);
    if (definition.format === 'secret') {
      if (action.id === id && action.type === 'field') setSecretDrafts(current => ({ ...current, [key]: action.text }));
      // Enter saves; leaving the field does not.
      else if ((action.id === id && action.type === 'commit' && action.value === 1) || action.id === `${id}:save`) void saveSecret(key);
      else if (action.id === `${id}:clear`) void write(key, '', false);
      return;
    }
    if (action.type === 'popup') void write(key, definition.type === 'number' ? Number(action.text) : action.text, true);
    else if (action.type === 'switch') void write(key, action.value === 1, true);
    else if (action.type === 'field') setDrafts(current => ({ ...current, [key]: action.text }));
    else if (action.type === 'commit') commitText(key, definition, action.text);
  });
  return null;
}

interface UpdateRowsProps {
  info: PluginUpdateInfo;
  busy: boolean;
  prefix: string;
  onUpdate: () => void;
  onSetSource: (source: PluginUpdateSource | null) => void;
}

function UpdateRows({ info, busy, prefix, onUpdate, onSetSource }: UpdateRowsProps) {
  const { t } = useTranslation();
  const { kind, setKind, value, setValue, channel, setChannel, save } = usePluginUpdateSource(info, onSetSource);
  // The draft follows a newly stored source, also while its field is focused.
  const [revision, setRevision] = useState(0);
  const sourceKey = JSON.stringify(info.source);
  useEffect(() => setRevision(current => current + 1), [sourceKey]);
  useReportedRows(prefix, updateRows(prefix, {
    info, busy, kind, value, valueRevision: revision, channel, official: isOfficialMusicSource(info.id),
  }, t), action => {
    if (action.id === `${prefix}:apply`) onUpdate();
    else if (action.id === `${prefix}:kind` && action.type === 'popup') setKind(action.text as PluginUpdateSource['kind'] | 'none');
    else if (action.id === `${prefix}:value` && action.type === 'field') setValue(action.text);
    else if (action.id === `${prefix}:channel` && action.type === 'popup') setChannel(action.text as PluginUpdateChannel);
    else if (action.id === `${prefix}:save`) save();
  });
  return null;
}
