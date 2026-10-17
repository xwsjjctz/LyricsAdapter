import type { PluginContext } from '@lyrics-adapter/plugin-sdk';

export type ApiFormat = 'openai' | 'anthropic';
export type TranslationStyle = 'natural' | 'faithful' | 'poetic';

export interface TranslatorSettings {
  format: ApiFormat;
  /** Base URL including the version path, without a trailing slash. */
  baseUrl: string;
  /** True when the request goes to the vendor's own API rather than a compatible server. */
  official: boolean;
  apiKey: string;
  model: string;
  style: TranslationStyle;
  instructions: string;
  jsonMode: boolean;
  timeoutMs: number;
  useCache: boolean;
}

const OFFICIAL_BASE_URL: Record<ApiFormat, string> = {
  openai: 'https://api.openai.com/v1',
  anthropic: 'https://api.anthropic.com/v1',
};
const DEFAULT_MODEL: Record<ApiFormat, string> = { openai: '', anthropic: 'claude-opus-5-5' };
const MIN_TIMEOUT_SECONDS = 10;
const MAX_TIMEOUT_SECONDS = 120;

const text = (context: PluginContext, key: string): string => String(context.configuration.get(key)).trim();

/** Reads the configuration fresh for every request so saved changes apply immediately. */
export function readSettings(context: PluginContext): TranslatorSettings {
  const format: ApiFormat = text(context, 'api-format') === 'anthropic' ? 'anthropic' : 'openai';
  const endpoint = text(context, 'endpoint').replace(/\/+$/, '');
  const baseUrl = endpoint || OFFICIAL_BASE_URL[format];
  const model = text(context, 'model') || DEFAULT_MODEL[format];
  if (!model) throw new Error('请在插件设置中填写模型名称');
  const style = text(context, 'style');
  const seconds = Number(context.configuration.get('timeout-seconds'));
  return {
    format,
    baseUrl,
    official: baseUrl === OFFICIAL_BASE_URL[format],
    apiKey: text(context, 'api-key'),
    model,
    style: style === 'faithful' || style === 'poetic' ? style : 'natural',
    instructions: text(context, 'instructions'),
    jsonMode: context.configuration.get('json-mode') === true,
    timeoutMs: Math.round(Math.min(MAX_TIMEOUT_SECONDS, Math.max(MIN_TIMEOUT_SECONDS, Number.isFinite(seconds) ? seconds : 90)) * 1000),
    useCache: context.configuration.get('use-cache') === true,
  };
}
