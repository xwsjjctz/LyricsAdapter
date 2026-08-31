'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const PACKAGE_NAME = '@lyrics-adapter/macos-statusbar-native';
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
const prebuildDirectory = path.join(
  sourceRoot,
  'prebuilds',
  `darwin-${process.arch}`,
);
const prebuildPath = path.join(prebuildDirectory, 'node.napi.node');
const metadataPath = path.join(prebuildDirectory, 'metadata.json');
const sourcePaths = [
  path.join(sourceRoot, 'binding.gyp'),
  path.join(sourceRoot, 'src', 'addon.mm'),
];

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

function isCurrentPrebuild() {
  if (!fs.existsSync(prebuildPath)) return false;
  try {
    const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
    return metadata.arch === process.arch
      && metadata.nodeApi === 8
      && metadata.sourceHash === sourceHash();
  } catch {
    return false;
  }
}

if (isCurrentPrebuild()) {
  console.log(`[MacosStatusbarNative] ${process.arch} Node-API v8 prebuild is current.`);
  process.exit(0);
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

const binaryPath = path.join(
  installedRoot,
  'build',
  'Release',
  'macos_statusbar_native.node',
);
if (!fs.existsSync(binaryPath)) {
  console.error('[MacosStatusbarNative] Rebuild did not produce the native module.');
  process.exit(1);
}

fs.mkdirSync(prebuildDirectory, { recursive: true });
fs.copyFileSync(binaryPath, prebuildPath);
fs.writeFileSync(metadataPath, `${JSON.stringify({
  arch: process.arch,
  nodeApi: 8,
  electronVersionUsedToBuild: require('electron/package.json').version,
  sourceHash: sourceHash(),
}, null, 2)}\n`, 'utf8');

const installedPrebuildDirectory = path.join(
  installedRoot,
  'prebuilds',
  `darwin-${process.arch}`,
);
if (path.resolve(installedPrebuildDirectory) !== path.resolve(prebuildDirectory)) {
  fs.mkdirSync(installedPrebuildDirectory, { recursive: true });
  fs.copyFileSync(prebuildPath, path.join(installedPrebuildDirectory, 'node.napi.node'));
  fs.copyFileSync(metadataPath, path.join(installedPrebuildDirectory, 'metadata.json'));
}

console.log(`[MacosStatusbarNative] Wrote ${process.arch} Node-API prebuild: ${prebuildPath}`);
