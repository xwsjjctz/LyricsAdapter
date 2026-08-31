'use strict';

if (process.platform !== 'win32') process.exit(0);

if (!['x64', 'arm64'].includes(process.arch)) process.exit(0);

console.log('[TaskbarNative] Source module will be compiled for Electron by the application build.');
