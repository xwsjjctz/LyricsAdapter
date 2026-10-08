import fs from 'node:fs';
import path from 'node:path';

/** Migrate only plugin directories; an existing new installation always wins. */
export function prepareMusicPluginDirectory(stateDirectory: string): string {
  const directory = path.join(stateDirectory, 'plugin');
  fs.mkdirSync(directory, { recursive: true });
  const legacy = path.join(stateDirectory, 'music-plugins');
  if (fs.existsSync(legacy) && !fs.lstatSync(legacy).isSymbolicLink()) {
    for (const item of fs.readdirSync(legacy, { withFileTypes: true })) {
      if (!item.isDirectory() || item.isSymbolicLink() || !/^[a-z][a-z0-9-]{0,63}$/.test(item.name)) continue;
      const target = path.join(directory, item.name);
      if (!fs.existsSync(target)) fs.renameSync(path.join(legacy, item.name), target);
    }
    if (fs.readdirSync(legacy).length === 0) fs.rmdirSync(legacy);
  }
  return directory;
}
