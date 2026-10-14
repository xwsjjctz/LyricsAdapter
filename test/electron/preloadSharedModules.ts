import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { ModuleKind, ScriptTarget, transpileModule } from 'typescript';

/**
 * The sandboxed preload may only require 'electron'; its own src/shared
 * imports are bundled into preload.cjs. These harnesses mirror that by
 * evaluating the dependency-free shared modules the preload imports.
 */
const BUNDLED = new Set(['../src/shared/preloadArguments']);

export function bundledPreloadModule(specifier: string): unknown {
  if (!BUNDLED.has(specifier)) return undefined;
  const file = path.resolve(process.cwd(), 'electron', `${specifier}.ts`);
  const source = transpileModule(readFileSync(file, 'utf8'), {
    compilerOptions: { module: ModuleKind.CommonJS, target: ScriptTarget.ES2022 },
    fileName: file,
  }).outputText;
  const module = { exports: {} as Record<string, unknown> };
  vm.runInNewContext(source, { module, exports: module.exports }, { filename: file });
  return module.exports;
}

export const SANDBOXED_PRELOAD_ARGV = ['electron', '--lyrics-adapter-os-release=25.0.0'];
