import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
// Optional independent checkout; the main application never needs these sources to start.
const source = path.resolve(root, process.env.LYRICS_ADAPTER_MUSIC_PLUGIN_SOURCE ?? '../LyricsAdapter-Music-Plugins');
const entry = path.join(source, 'scripts/build.mjs');
if (!existsSync(entry)) {
  console.error('[music-plugins] 请克隆独立的 LyricsAdapter-Music-Plugins 仓库并安装依赖，或通过 LYRICS_ADAPTER_MUSIC_PLUGIN_SOURCE 指定源码目录。');
  process.exit(1);
}
const result = spawnSync(process.execPath, [entry, path.resolve(root, process.argv[2] ?? 'dist-music-plugins')], { cwd: source, stdio: 'inherit' });
if (result.error) console.error(result.error.message);
process.exit(result.status ?? 1);
