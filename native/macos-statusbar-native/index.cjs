'use strict';

const fs = require('node:fs');
const path = require('node:path');

if (process.platform !== 'darwin') {
  throw new Error('@lyrics-adapter/macos-statusbar-native only supports macOS.');
}

if (!['arm64', 'x64'].includes(process.arch)) {
  throw new Error(`Unsupported macOS architecture: ${process.arch}`);
}

const prebuild = path.join(
  __dirname,
  'prebuilds',
  `darwin-${process.arch}`,
  'node.napi.node',
);
const sourceBuild = path.join(
  __dirname,
  'build',
  'Release',
  'macos_statusbar_native.node',
);
module.exports = require(fs.existsSync(prebuild) ? prebuild : sourceBuild);
