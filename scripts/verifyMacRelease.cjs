'use strict';

const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

/** electron-builder 26 calls afterSign after signing, notarizing and stapling the app. */
module.exports = function verifyMacRelease(context) {
  if (context.electronPlatformName !== 'darwin') return;
  if (context.packager.platformSpecificBuildOptions.forceCodeSigning !== true) return;
  const appPath = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  const signature = spawnSync('/usr/bin/codesign', ['--display', '--verbose=2', appPath], {
    encoding: 'utf8', timeout: 30_000,
  });
  if (signature.status !== 0 || !/^Authority=Developer ID Application: /m.test(signature.stderr ?? '')) {
    throw new Error('The macOS release is not signed with Developer ID Application.');
  }
  const options = { stdio: 'inherit', timeout: 120_000 };
  execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', appPath], options);
  execFileSync('/usr/bin/xcrun', ['stapler', 'validate', appPath], options);
  execFileSync('/usr/sbin/spctl', ['--assess', '--type', 'execute', '--verbose=2', appPath], options);
  console.log('[MacRelease] Signature, notarization ticket and Gatekeeper assessment passed.');
};
