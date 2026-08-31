'use strict';

if (process.platform !== 'darwin') process.exit(0);
if (!['arm64', 'x64'].includes(process.arch)) process.exit(0);

console.log('[MacosStatusbarNative] Source module will be compiled for Electron by the application build.');
