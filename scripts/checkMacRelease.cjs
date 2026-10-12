'use strict';

/** Fail before packaging rather than silently publishing an unsigned or unnotarized Mac build. */
function checkMacReleaseCredentials(env = process.env) {
  const required = ['CSC_LINK', 'CSC_KEY_PASSWORD', 'APPLE_ID', 'APPLE_APP_SPECIFIC_PASSWORD', 'APPLE_TEAM_ID'];
  const missing = required.filter(name => !env[name]?.trim());
  if (missing.length) {
    throw new Error(`Missing macOS release credentials: ${missing.join(', ')}. For local testing use npm run electron:build:mac:dev.`);
  }
}

function beforePack(context) {
  if (context.electronPlatformName !== 'darwin') return;
  const options = context.packager.platformSpecificBuildOptions;
  const isLocalDirectory = context.targets.length === 0;
  const unsigned = options.forceCodeSigning === false && options.notarize === false;
  // The release workflow opts in to an unsigned DMG while no Developer ID credentials exist.
  if (unsigned && (isLocalDirectory || process.env.LYRICSADAPTER_UNSIGNED_MAC === '1')) return;
  if (options.forceCodeSigning !== true || options.hardenedRuntime !== true || options.notarize !== true) {
    throw new Error('macOS distribution requires forceCodeSigning, hardenedRuntime and notarize.');
  }
  if (options.identity === '-' || options.identity === null || options.type === 'development') {
    throw new Error('macOS distribution requires a Developer ID Application identity.');
  }
  checkMacReleaseCredentials();
}

module.exports = beforePack;
module.exports.checkMacReleaseCredentials = checkMacReleaseCredentials;

if (require.main === module) {
  try {
    checkMacReleaseCredentials();
    console.log('[MacRelease] Required signing and notarization credentials are configured.');
  } catch (error) {
    console.error(`[MacRelease] ${error.message}`);
    process.exitCode = 1;
  }
}
