import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

import type { UpdaterUnavailableReason } from '../../src/shared/updater';

export type { UpdaterUnavailableReason };

/** Inspect the installed app once; development and ad-hoc packages never poll releases. */
export function getUpdaterUnavailableReason(context: {
  platform: string;
  isPackaged: boolean;
  resourcesPath: string;
  executablePath: string;
}): UpdaterUnavailableReason | null {
  if (!context.isPackaged) return 'dev';
  if (context.platform !== 'darwin' && context.platform !== 'win32') return 'unsupported';
  if (!existsSync(path.join(context.resourcesPath, 'app-update.yml'))) return 'unconfigured';
  if (context.platform === 'darwin') {
    const bundlePath = path.resolve(context.executablePath, '../../..');
    const signature = spawnSync('/usr/bin/codesign', ['--display', '--verbose=2', bundlePath], {
      encoding: 'utf8',
      timeout: 5000,
    });
    // This gates availability, not update integrity. Squirrel verifies the downloaded signature.
    if (signature.status !== 0 || !/^Authority=Developer ID Application: /m.test(signature.stderr ?? '')) {
      return 'unsigned';
    }
  }
  return null;
}
