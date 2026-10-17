import type { LyricTrackMetadata } from '@lyrics-adapter/plugin-sdk';
import type { TranslationStyle } from './settings';

/** Bump when the prompt changes enough that cached translations should be redone. */
export const PROMPT_VERSION = 1;

const LANGUAGE_NAMES: Record<string, string> = {
  zh: 'Simplified Chinese', 'zh-cn': 'Simplified Chinese', 'zh-hans': 'Simplified Chinese',
  'zh-tw': 'Traditional Chinese', 'zh-hant': 'Traditional Chinese',
  en: 'English', ja: 'Japanese', ko: 'Korean', fr: 'French', de: 'German', es: 'Spanish', ru: 'Russian',
};

const STYLE_RULES: Record<TranslationStyle, string> = {
  natural: 'Write fluent, natural lyrics a native speaker would read comfortably, keeping the meaning and mood.',
  faithful: 'Stay close to the literal meaning and the original wording; do not embellish.',
  poetic: 'Keep the imagery, rhythm and emotional tone; a poetic, lyrical rendering is welcome.',
};

export function languageName(tag: string): string {
  return LANGUAGE_NAMES[tag.toLowerCase()] ?? tag;
}

export interface PromptInput {
  targetLanguage: string;
  style: TranslationStyle;
  instructions: string;
  metadata?: LyricTrackMetadata | undefined;
  /** Unique lyric texts, keyed by a short numeric id. */
  lines: readonly { id: string; text: string }[];
}

export function systemPrompt(input: PromptInput): string {
  const target = languageName(input.targetLanguage);
  return [
    `You translate song lyrics into ${target}.`,
    'You receive a JSON object with song information and numbered lyric lines. Read every line first so each translation fits the whole song.',
    STYLE_RULES[input.style],
    'Rules:',
    '- Return exactly one translation for each input id, translating that line only. Never merge, split or reorder lines.',
    `- If a line is already in ${target}, or has nothing to translate (pure vocalisations such as "la la", "oh", or credit lines such as composer/lyricist/producer), return an empty string for it.`,
    '- Keep personal names, brand names and intentional foreign words in their usual form.',
    '- Output only JSON in the form {"translations":[{"id":"1","text":"..."}]} with no commentary or code fences.',
    ...(input.instructions ? [`Additional requirements from the listener: ${input.instructions}`] : []),
  ].join('\n');
}

export function userPrompt(input: PromptInput): string {
  const song = Object.fromEntries(Object.entries(input.metadata ?? {}).filter(([, value]) => typeof value === 'string' && value));
  return JSON.stringify({ song, targetLanguage: input.targetLanguage, lines: input.lines });
}

/** Extracts `{ id: text }` from a model reply, tolerating code fences and surrounding prose. */
export function parseTranslations(reply: string, expectedIds: ReadonlySet<string>): Map<string, string> {
  const start = reply.search(/[[{]/);
  const end = Math.max(reply.lastIndexOf('}'), reply.lastIndexOf(']'));
  if (start < 0 || end <= start) throw new Error('Model reply contains no JSON');
  const parsed: unknown = JSON.parse(reply.slice(start, end + 1));
  const items = Array.isArray(parsed) ? parsed
    : parsed && typeof parsed === 'object' && Array.isArray((parsed as { translations?: unknown }).translations)
      ? (parsed as { translations: unknown[] }).translations : undefined;
  if (!items) throw new Error('Model reply has no translations array');
  const result = new Map<string, string>();
  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    const { id, text } = item as { id?: unknown; text?: unknown };
    const key = typeof id === 'number' ? String(id) : id;
    if (typeof key !== 'string' || !expectedIds.has(key) || typeof text !== 'string' || result.has(key)) continue;
    result.set(key, text.trim());
  }
  return result;
}
