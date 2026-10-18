import type { LyricDocument, LyricsTranslationProvider, PluginContext, TranslationRequest, TranslationResult } from '@lyrics-adapter/plugin-sdk';
import { chat } from './llmClient';
import { parseTranslations, PROMPT_VERSION, systemPrompt, userPrompt } from './prompt';
import { readSettings, type TranslatorSettings } from './settings';
import { readCachedTranslation, variantKey, writeCachedTranslation } from './translationCache';

/** Lines per model request; long songs are split so each reply stays small and fast. */
const CHUNK_SIZE = 60;
const PARALLEL_CHUNKS = 2;
/** A reply that covers less than this share of its lines is treated as a failure and retried once. */
const MIN_COVERAGE = 0.5;
/** Hosts before lyrics.translation 1.2 do not report the deadline; they allow 180 seconds. */
const LEGACY_HOST_TIMEOUT_MS = 180_000;
/** Kept back from the host's deadline for the cache write and the reply. */
const DEADLINE_MARGIN_MS = 2_000;
/** A model request with less time left than this is not started. */
const MIN_REQUEST_MS = 5_000;

interface UniqueLine { id: string; text: string; lineIds: string[] }

/** Repeated lines (choruses) are translated once and fanned back out by line id. */
function uniqueLines(document: LyricDocument): UniqueLine[] {
  const byText = new Map<string, UniqueLine>();
  for (const line of document.lines) {
    const text = line.text.trim();
    if (!text) continue;
    const existing = byText.get(text);
    if (existing) existing.lineIds.push(line.id);
    else byText.set(text, { id: String(byText.size + 1), text, lineIds: [line.id] });
  }
  return [...byText.values()];
}

async function translateChunk(context: PluginContext, settings: TranslatorSettings, request: TranslationRequest,
  chunk: readonly UniqueLine[], signal: AbortSignal, deadline: number): Promise<Map<string, string>> {
  const input = {
    targetLanguage: request.targetLanguage, style: settings.style, instructions: settings.instructions,
    metadata: request.document.metadata, lines: chunk.map(({ id, text }) => ({ id, text })),
  };
  const ids = new Set(chunk.map(line => line.id));
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    signal.throwIfAborted();
    const remaining = deadline - Date.now();
    // A request the host would abandon midway only wastes tokens; report the earlier failure instead.
    if (remaining < MIN_REQUEST_MS) throw lastError ?? new Error('Translation ran out of the time the host allows');
    try {
      const timeoutMs = Math.min(settings.timeoutMs, Math.floor(remaining));
      const reply = await chat(context, settings, { system: systemPrompt(input), user: userPrompt(input), signal, timeoutMs });
      const translations = parseTranslations(reply, ids);
      if (translations.size >= Math.ceil(chunk.length * MIN_COVERAGE)) return translations;
      lastError = new Error(`Model translated only ${translations.size} of ${chunk.length} lines`);
    } catch (error) {
      // Network and API errors are not retried here; malformed replies are.
      if (signal.aborted || !(error instanceof SyntaxError || /JSON|translations array/.test((error as Error).message))) throw error;
      lastError = error;
    }
  }
  throw lastError;
}

async function translateWithModel(context: PluginContext, settings: TranslatorSettings, request: TranslationRequest,
  signal: AbortSignal, deadline: number): Promise<Record<string, string>> {
  const unique = uniqueLines(request.document);
  const chunks: UniqueLine[][] = [];
  for (let index = 0; index < unique.length; index += CHUNK_SIZE) chunks.push(unique.slice(index, index + CHUNK_SIZE));
  const lines: Record<string, string> = {};
  for (let index = 0; index < chunks.length; index += PARALLEL_CHUNKS) {
    const batch = chunks.slice(index, index + PARALLEL_CHUNKS);
    const results = await Promise.all(batch.map(chunk => translateChunk(context, settings, request, chunk, signal, deadline)));
    batch.forEach((chunk, position) => {
      for (const line of chunk) {
        const text = results[position]?.get(line.id);
        if (text === undefined) continue;
        for (const lineId of line.lineIds) lines[lineId] = text;
      }
    });
  }
  return lines;
}

function result(request: TranslationRequest, lines: Record<string, string>): TranslationResult {
  return {
    documentId: request.document.id,
    documentRevision: request.document.revision,
    targetLanguage: request.targetLanguage,
    // Empty translations mean "nothing to translate"; the host then shows the original line only.
    lines: request.document.lines.flatMap(line => lines[line.id] ? [{ lineId: line.id, text: lines[line.id]! }] : []),
  };
}

export function activate(context: PluginContext): void {
  const provider: LyricsTranslationProvider = {
    async translate(request, { signal, timeoutMs }) {
      signal.throwIfAborted();
      const deadline = Date.now() + (timeoutMs ?? LEGACY_HOST_TIMEOUT_MS) - DEADLINE_MARGIN_MS;
      const settings = readSettings(context);
      const variant = variantKey(request.targetLanguage, JSON.stringify([PROMPT_VERSION, settings.style, settings.instructions]));
      if (settings.useCache) {
        try {
          const cached = await readCachedTranslation(context, request.document, variant);
          if (cached) { context.logger.debug('Translation served from cache'); return result(request, cached); }
        } catch (error) { context.logger.warn('Translation cache read failed', error); }
      }
      const started = Date.now();
      const lines = await translateWithModel(context, settings, request, signal, deadline);
      context.logger.info(`Translated ${Object.keys(lines).length}/${request.document.lines.length} lines with ${settings.model} in ${Date.now() - started} ms`);
      if (settings.useCache) {
        // A failed cache write must not discard a translation that already cost a model call.
        await writeCachedTranslation(context, request.document, variant, settings.model, lines)
          .catch(error => context.logger.warn('Translation cache write failed', error));
      }
      return result(request, lines);
    },
  };
  context.extensions.register('lyrics.translation', 'default', provider);
}
