import zh from '../../src/i18n/locales/zh.json';
import en from '../../src/i18n/locales/en.json';
import ja from '../../src/i18n/locales/ja.json';
import ko from '../../src/i18n/locales/ko.json';
import de from '../../src/i18n/locales/de.json';
import fr from '../../src/i18n/locales/fr.json';
import { settingsStore } from './settingsStore';

const resources: Record<string, Record<string, string>> = { zh, en, ja, ko, de, fr };

export type Translate = (key: string, values?: Record<string, string>) => string;

/** Main-process strings follow the renderer's language setting and locale files. */
export function mainTranslator(language = settingsStore.get('app-language') ?? 'zh'): Translate {
  const labels: Record<string, string> = resources[language] ?? zh;
  return (key, values = {}) => {
    const template = labels[key] ?? (zh as Record<string, string>)[key] ?? key;
    return template.replace(/\{\{(\w+)\}\}/g, (match: string, name: string) => values[name] ?? match);
  };
}
