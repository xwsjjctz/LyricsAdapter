import type { PluginContext } from '@lyrics-adapter/plugin-sdk';
import type { TranslatorSettings } from './settings';

export interface ChatRequest {
  system: string;
  user: string;
  signal: AbortSignal;
  /** The configured timeout, shortened to fit what is left of the host's deadline. */
  timeoutMs: number;
}

/** Claude models that accept the server-side refusal fallback (`fallbacks: "default"`). */
const FALLBACK_MODELS = new Set(['claude-fable-5-1', 'claude-opus-5-5', 'claude-opus-5', 'claude-sonnet-5-5']);
const MAX_OUTPUT_TOKENS = 16_000;

function parseJson(text: string, what: string): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(text);
    if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  } catch { /* reported below */ }
  throw new Error(`${what} returned an unreadable response`);
}

async function openAiChat(context: PluginContext, settings: TranslatorSettings, request: ChatRequest): Promise<string> {
  const body = {
    model: settings.model,
    messages: [{ role: 'system', content: request.system }, { role: 'user', content: request.user }],
    ...(settings.jsonMode ? { response_format: { type: 'json_object' } } : {}),
  };
  const reply = parseJson(await context.network.fetchText(`${settings.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(settings.apiKey ? { authorization: `Bearer ${settings.apiKey}` } : {}) },
    body: JSON.stringify(body),
    signal: request.signal,
    timeoutMs: request.timeoutMs,
  }), 'OpenAI-compatible API');
  const choice = (reply['choices'] as { message?: { content?: unknown }; finish_reason?: unknown }[] | undefined)?.[0];
  if (choice?.finish_reason === 'length') throw new Error('Model output was cut off (finish_reason: length)');
  if (typeof choice?.message?.content !== 'string') throw new Error('OpenAI-compatible API returned no message content');
  return choice.message.content;
}

async function anthropicChat(context: PluginContext, settings: TranslatorSettings, request: ChatRequest): Promise<string> {
  if (!settings.apiKey) throw new Error('请在插件设置中填写 Anthropic API Key');
  // Opt into server-side refusal fallback on the vendor API for the models that support it.
  const fallback = settings.official && FALLBACK_MODELS.has(settings.model);
  const body = {
    model: settings.model,
    max_tokens: MAX_OUTPUT_TOKENS,
    system: request.system,
    messages: [{ role: 'user', content: request.user }],
    ...(fallback ? { fallbacks: 'default' } : {}),
  };
  const reply = parseJson(await context.network.fetchText(`${settings.baseUrl}/messages`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': settings.apiKey,
      'anthropic-version': '2023-06-01',
      ...(fallback ? { 'anthropic-beta': 'server-side-fallback-2026-07-01' } : {}),
    },
    body: JSON.stringify(body),
    signal: request.signal,
    timeoutMs: request.timeoutMs,
  }), 'Anthropic API');
  if (reply['stop_reason'] === 'refusal') throw new Error('Model declined to translate these lyrics');
  if (reply['stop_reason'] === 'max_tokens') throw new Error('Model output was cut off (stop_reason: max_tokens)');
  const blocks = Array.isArray(reply['content']) ? reply['content'] as { type?: unknown; text?: unknown }[] : [];
  const text = blocks.filter(block => block.type === 'text' && typeof block.text === 'string').map(block => block.text as string).join('');
  if (!text) throw new Error('Anthropic API returned no text');
  return text;
}

/** Sends one system + user turn and returns the model's text reply. */
export function chat(context: PluginContext, settings: TranslatorSettings, request: ChatRequest): Promise<string> {
  return settings.format === 'anthropic' ? anthropicChat(context, settings, request) : openAiChat(context, settings, request);
}
