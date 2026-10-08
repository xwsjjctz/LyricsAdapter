import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Verify the built package under NodeNext, outside the app's bundler aliases and ambient types.
const root = fileURLToPath(new URL('../', import.meta.url));
const temporary = await mkdtemp(path.join(os.tmpdir(), 'la-sdk-consumer-'));
try {
  const installed = path.join(temporary, 'node_modules/@lyrics-adapter/plugin-sdk');
  await mkdir(installed, { recursive: true });
  await cp(path.join(root, 'packages/plugin-sdk/package.json'), path.join(installed, 'package.json'));
  await cp(path.join(root, 'packages/plugin-sdk/dist'), path.join(installed, 'dist'), { recursive: true });
  await writeFile(path.join(temporary, 'package.json'), '{"type":"module"}');
  await writeFile(path.join(temporary, 'index.ts'), `
import { PLUGIN_CORE_API, type PluginContext, type MusicSourceProvider } from '@lyrics-adapter/plugin-sdk';
const sourceId: MusicSourceProvider['provider']['id'] = 'third-party';
const playlistSource: Awaited<ReturnType<MusicSourceProvider['provider']['getPlaylists']>>[number]['source'] = 'third-party';
export function activate(context: PluginContext) {
  context.logger.info(PLUGIN_CORE_API, sourceId, playlistSource);
  context.extensions.register('lyrics.translation', 'default', {
    async translate({ document, targetLanguage }, { signal }) {
      signal.throwIfAborted();
      return { documentId: document.id, documentRevision: document.revision, targetLanguage, lines: [] };
    }
  });
}
`);
  await writeFile(path.join(temporary, 'tsconfig.json'), JSON.stringify({ compilerOptions: { strict: true, noEmit: true, module: 'NodeNext', moduleResolution: 'NodeNext', target: 'ES2022', lib: ['ES2022', 'DOM'], types: [] }, include: ['index.ts'] }));
  const result = spawnSync(process.execPath, [path.join(root, 'node_modules/typescript/bin/tsc'), '-p', path.join(temporary, 'tsconfig.json')], { stdio: 'inherit' });
  if (result.status !== 0) throw new Error('Installed plugin SDK type check failed');
  await writeFile(path.join(temporary, 'runtime.mjs'), `import { PLUGIN_CORE_API, PLUGIN_EXTENSION_APIS } from '@lyrics-adapter/plugin-sdk'; if (PLUGIN_CORE_API !== '1.0.0' || !PLUGIN_EXTENSION_APIS['lyrics.translation']) throw new Error('Invalid SDK runtime exports');`);
  const runtime = spawnSync(process.execPath, [path.join(temporary, 'runtime.mjs')], { stdio: 'inherit' });
  if (runtime.status !== 0) throw new Error('Installed plugin SDK runtime import failed');
  console.log('Plugin SDK: isolated NodeNext consumer and runtime imports passed');
} finally { await rm(temporary, { recursive: true, force: true }); }
