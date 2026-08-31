'use strict';

const fs = require('node:fs');
const path = require('node:path');

if (process.platform !== 'win32') process.exit(0);

const filenames = {
  x64: ['win32-x64', 'node.napi.node'],
  arm64: ['win32-arm64', 'node.napi.armv8.node'],
};
const target = filenames[process.arch];
if (!target) process.exit(0);

const prebuild = path.join(__dirname, 'prebuilds', ...target);
if (fs.existsSync(prebuild)) {
  console.log(`[TaskbarNative] Using bundled ${process.arch} Node-API prebuild.`);
} else {
  console.warn(`[TaskbarNative] No bundled ${process.arch} prebuild; a maintainer source rebuild is required.`);
}
