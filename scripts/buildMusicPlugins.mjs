import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const entry = path.join(root, 'music-source-plugins/scripts/build.mjs');
const output = path.resolve(root, process.argv[2] ?? 'dist-music-plugins');

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit' });
  if (result.error) console.error(`[music-plugins] ${result.error.message}`);
  return result.status ?? 1;
}

if (!existsSync(entry)) {
  console.log('[music-plugins] 插件源码缺失，正在初始化项目锁定版本的子模块…');
  // Only recover missing sources. Never reset an existing plugin working tree or
  // follow the remote branch: the parent repository's gitlink selects the version.
  const status = run('git', ['submodule', 'update', '--init', '--recursive', '--', 'music-source-plugins']);
  if (status !== 0 || !existsSync(entry)) {
    console.error('[music-plugins] 无法恢复插件源码。请在项目根目录运行 git submodule update --init --recursive -- music-source-plugins，成功后运行 npm --prefix music-source-plugins ci 再重试。');
    process.exit(status || 1);
  }
}

process.exit(run(process.execPath, [entry, output]));
