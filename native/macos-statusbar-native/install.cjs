'use strict';

const fs = require('node:fs');
const path = require('node:path');

if (process.platform !== 'darwin') process.exit(0);
if (!['arm64', 'x64'].includes(process.arch)) process.exit(0);

const prebuild = path.join(
  __dirname,
  'prebuilds',
  `darwin-${process.arch}`,
  'node.napi.node',
);
if (fs.existsSync(prebuild)) {
  console.log(`[MacosStatusbarNative] Using bundled ${process.arch} Node-API prebuild.`);
} else {
  console.warn('[MacosStatusbarNative] No bundled prebuild; the application rebuild step will compile it from source.');
}
