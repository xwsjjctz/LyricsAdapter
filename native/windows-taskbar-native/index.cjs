'use strict';

const fs = require('node:fs');
const path = require('node:path');

if (process.platform !== 'win32') {
  throw new Error('@lyrics-adapter/windows-taskbar-native only supports Windows.');
}

const filenames = {
  x64: ['win32-x64', 'node.napi.node'],
  arm64: ['win32-arm64', 'node.napi.armv8.node'],
};
const target = filenames[process.arch];
if (!target) {
  throw new Error(`Unsupported Windows architecture: ${process.arch}`);
}

const prebuild = path.join(__dirname, 'prebuilds', ...target);
const sourceBuild = path.join(__dirname, 'build', 'Release', 'windows_taskbar_native.node');
module.exports = require(fs.existsSync(prebuild) ? prebuild : sourceBuild);
