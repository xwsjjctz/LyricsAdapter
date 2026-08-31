'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const PACKAGE_NAME = '@lyrics-adapter/macos-statusbar-native';
const FORCE_REBUILD = process.argv.includes('--from-source')
  || process.argv.includes('--force');
const ALLOW_MISSING = process.argv.includes('--allow-missing');

if (process.platform !== 'darwin') process.exit(0);
if (!['arm64', 'x64'].includes(process.arch)) {
  console.error(`[MacosStatusbarNative] Unsupported architecture: ${process.arch}`);
  process.exit(1);
}

const projectRoot = process.cwd();
const sourceRoot = path.join(projectRoot, 'native', 'macos-statusbar-native');
const installedRoot = path.join(
  projectRoot,
  'node_modules',
  '@lyrics-adapter',
  'macos-statusbar-native',
);
const binaryPath = path.join(
  installedRoot,
  'build',
  'Release',
  'macos_statusbar_native.node',
);
const metadataPath = path.join(
  installedRoot,
  'build',
  'Release',
  '.lyrics-adapter-native.json',
);
const sourcePaths = [
  path.join(sourceRoot, 'binding.gyp'),
  path.join(sourceRoot, 'src', 'addon.mm'),
];
const electronVersion = require('electron/package.json').version;

function sourceHash() {
  const hash = crypto.createHash('sha256');
  for (const sourcePath of sourcePaths) {
    hash.update(path.relative(sourceRoot, sourcePath));
    hash.update('\0');
    hash.update(fs.readFileSync(sourcePath));
    hash.update('\0');
  }
  return hash.digest('hex');
}

function isCurrentBuild() {
  if (!fs.existsSync(binaryPath)) return false;
  try {
    const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
    return metadata.arch === process.arch
      && metadata.nodeApi === 8
      && metadata.electronVersion === electronVersion
      && metadata.sourceHash === sourceHash();
  } catch {
    return false;
  }
}

if (!fs.existsSync(path.join(installedRoot, 'package.json'))) {
  const message = `[MacosStatusbarNative] Missing installed optional dependency: ${PACKAGE_NAME}`;
  if (ALLOW_MISSING) {
    console.warn(message);
    process.exit(0);
  }
  console.error(message);
  process.exit(1);
}

if (!FORCE_REBUILD && isCurrentBuild()) {
  console.log(`[MacosStatusbarNative] ${process.arch} source build is current.`);
  process.exit(0);
}

const rebuildMain = require.resolve('@electron/rebuild');
const rebuildCli = path.join(path.dirname(rebuildMain), 'cli.js');
const result = spawnSync(process.execPath, [
  rebuildCli,
  '--force',
  '--build-from-source',
  '--disable-pre-gyp-copy',
  '--only',
  PACKAGE_NAME,
  '--arch',
  process.arch,
], {
  cwd: projectRoot,
  env: {
    ...process.env,
    NODE_OPTIONS: [process.env.NODE_OPTIONS, '--disable-warning=DEP0190']
      .filter(Boolean)
      .join(' '),
  },
  stdio: 'inherit',
});

if (result.error) {
  console.error('[MacosStatusbarNative] Failed to start electron-rebuild:', result.error);
  process.exit(1);
}
if (result.status !== 0) process.exit(result.status ?? 1);
if (!fs.existsSync(binaryPath)) {
  console.error('[MacosStatusbarNative] Rebuild did not produce the native module.');
  process.exit(1);
}

fs.writeFileSync(metadataPath, `${JSON.stringify({
  arch: process.arch,
  nodeApi: 8,
  electronVersion,
  sourceHash: sourceHash(),
}, null, 2)}\n`, 'utf8');
console.log(`[MacosStatusbarNative] Built ${process.arch} Node-API module: ${binaryPath}`);
