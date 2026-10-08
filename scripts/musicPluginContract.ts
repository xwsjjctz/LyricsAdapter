import type { PluginContext, LyricsTranslationProvider, MusicPlugin } from '../packages/plugin-sdk/index';
import type { MusicPlugin as LegacyMusicPlugin } from '../src/shared/musicPlugin';
// Public SDK exports the same legacy contract while new plugins register typed capabilities.
const acceptsLegacy = (plugin: MusicPlugin): LegacyMusicPlugin => plugin;
const registersTranslation = (context: PluginContext, provider: LyricsTranslationProvider) => context.extensions.register('lyrics.translation', 'default', provider);
void acceptsLegacy;
void registersTranslation;
