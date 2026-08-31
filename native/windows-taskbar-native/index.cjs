'use strict';

const path = require('node:path');

if (process.platform !== 'win32') {
  throw new Error('@lyrics-adapter/windows-taskbar-native only supports Windows.');
}

if (!['x64', 'arm64'].includes(process.arch)) {
  throw new Error(`Unsupported Windows architecture: ${process.arch}`);
}

const sourceBuild = path.join(__dirname, 'build', 'Release', 'windows_taskbar_native.node');
module.exports = require(sourceBuild);
