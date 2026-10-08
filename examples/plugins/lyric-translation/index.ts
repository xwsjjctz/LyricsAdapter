import type { PluginContext, LyricsTranslationProvider } from '@lyrics-adapter/plugin-sdk';

/** Demonstrates the contract; replace this formatter with a real translation service. */
export function activate(context: PluginContext): void {
  const provider: LyricsTranslationProvider = {
    async translate({ document, targetLanguage }, { signal }) {
      signal.throwIfAborted();
      const prefix = context.configuration.get('prefix');
      return { documentId: document.id, documentRevision: document.revision, targetLanguage,
        lines: document.lines.map(line => ({ lineId: line.id, text: `${prefix} (${targetLanguage}) · ${line.text}` })) };
    },
  };
  context.extensions.register('lyrics.translation', 'default', provider);
}
