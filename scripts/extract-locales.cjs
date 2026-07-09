/**
 * One-shot conversion script: src/services/i18n.ts → src/i18n/locales/*.json
 *
 * The existing translations live as a single inline object mapping
 *   key -> { zh, en, ja, ko, de, fr }
 * i18next wants the inverse shape per locale:
 *   locales/zh/translation.json  -> { key: "中文值", ... }
 *   locales/en/translation.json  -> { key: "English value", ... }
 *
 * This script reads ONLY the `translations` object literal from i18n.ts (it does
 * not import the module, which would pull in appStorage/desktopAdapter/Electron
 * at script time). It extracts the object body and evaluates it in a sandboxed
 * Function (the literal contains only strings, so this is safe), then writes one
 * JSON file per language.
 *
 * Usage:  node scripts/extract-locales.cjs
 * Re-runnable: overwrites the locale files. Safe to delete after migration.
 */
const fs = require('fs');
const path = require('path');

const SRC = path.resolve(__dirname, '..', 'src', 'services', 'i18n.ts');
const OUT_DIR = path.resolve(__dirname, '..', 'src', 'i18n', 'locales');
const LANGS = ['zh', 'en', 'ja', 'ko', 'de', 'fr'];

const src = fs.readFileSync(SRC, 'utf8');

// Locate the `translations` object literal: from `const translations: Translations = {`
// up to the matching closing `};` that sits on its own line before VALID_LANGUAGES.
const startMatch = /const\s+translations\s*:\s*Translations\s*=\s*\{/;
const startIdx = src.search(startMatch);
if (startIdx === -1) {
  console.error('Could not find `const translations` declaration in', SRC);
  process.exit(1);
}
// Find the opening brace, then the object body up to the line `\n};` that
// precedes `VALID_LANGUAGES`.
const braceOpen = src.indexOf('{', startIdx);
const endMarker = src.indexOf('};', braceOpen);
if (endMarker === -1) {
  console.error('Could not find closing `};` of translations object');
  process.exit(1);
}
const objectBody = src.slice(braceOpen, endMarker + 1); // includes braces

// Evaluate as an object literal. The body is pure data (strings, numbers),
// so wrapping in parentheses and using Function is safe and avoids needing a
// full TS parser.
let translations;
try {
  translations = new Function(`return (${objectBody});`)();
} catch (e) {
  console.error('Failed to parse translations object:', e.message);
  process.exit(1);
}

const keyCount = Object.keys(translations).length;
console.log(`Extracted ${keyCount} translation keys.`);

// Sanity: every key must have all 6 languages.
let malformed = 0;
for (const [key, vals] of Object.entries(translations)) {
  for (const lang of LANGS) {
    if (typeof vals[lang] !== 'string') {
      console.warn(`  ! key "${key}" missing language "${lang}"`);
      malformed++;
    }
  }
}
if (malformed) {
  console.error(`${malformed} missing language entries found; aborting.`);
  process.exit(1);
}

fs.mkdirSync(OUT_DIR, { recursive: true });

for (const lang of LANGS) {
  const out = {};
  for (const [key, vals] of Object.entries(translations)) {
    out[key] = vals[lang];
  }
  const file = path.join(OUT_DIR, `${lang}.json`);
  fs.writeFileSync(file, JSON.stringify(out, null, 2) + '\n', 'utf8');
  console.log(`  wrote ${path.relative(path.resolve(__dirname, '..'), file)} (${Object.keys(out).length} keys)`);
}

console.log('Done.');
