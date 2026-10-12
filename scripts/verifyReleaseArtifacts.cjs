'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
// The locked electron-builder toolchain supplies this YAML parser.
const { load } = require('js-yaml');
const { version } = require('../package.json');

function verifyReleaseArtifacts(directory, platform) {
  const metadataFile = platform === 'mac' ? 'latest-mac.yml' : 'latest.yml';
  const requiredExtensions = platform === 'mac' ? ['.dmg', '.zip'] : ['.exe'];
  const metadata = load(fs.readFileSync(path.join(directory, metadataFile), 'utf8'));
  if (metadata?.version !== version || !Array.isArray(metadata.files) || !metadata.files.length) {
    throw new Error(`${metadataFile}: missing files or version does not match package.json (${version}).`);
  }
  const extensions = new Set();
  for (const file of metadata.files) {
    const name = typeof file.url === 'string' ? decodeURIComponent(file.url) : '';
    if (!name || name !== path.basename(name) || /[\\/\s]/.test(name)) {
      throw new Error(`${metadataFile}: invalid release filename.`);
    }
    const artifact = fs.readFileSync(path.join(directory, name));
    const sha512 = createHash('sha512').update(artifact).digest('base64');
    if (sha512 !== file.sha512 || (file.size !== undefined && file.size !== artifact.length)) {
      throw new Error(`${metadataFile}: checksum or size mismatch for ${name}.`);
    }
    // Differential Windows updates fetch this next to the installer in both releases.
    if (platform === 'win' && !fs.existsSync(path.join(directory, `${name}.blockmap`))) {
      throw new Error(`${metadataFile}: missing ${name}.blockmap.`);
    }
    extensions.add(path.extname(name));
  }
  for (const extension of requiredExtensions) {
    if (!extensions.has(extension)) throw new Error(`${metadataFile}: missing ${extension} artifact.`);
  }
}

module.exports = { verifyReleaseArtifacts };

if (require.main === module) {
  try {
    const platform = process.argv[2];
    if (platform !== 'mac' && platform !== 'win') throw new Error('Expected mac or win.');
    verifyReleaseArtifacts(path.resolve('release'), platform);
    console.log(`[Release] ${platform} artifacts and update metadata are consistent.`);
  } catch (error) {
    console.error(`[Release] ${error.message}`);
    process.exitCode = 1;
  }
}
