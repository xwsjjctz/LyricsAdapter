'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const PACKAGE_NAME = '@lyrics-adapter/windows-taskbar-native';
const SOURCE_BUILD = process.argv.includes('--from-source')
  || process.argv.includes('--force');
const ALLOW_MISSING = process.argv.includes('--allow-missing');
const ARCHITECTURES = {
  x64: {
    directory: 'win32-x64',
    filename: 'node.napi.node',
    peMachine: 0x8664,
  },
  arm64: {
    directory: 'win32-arm64',
    filename: 'node.napi.armv8.node',
    peMachine: 0xaa64,
  },
};

if (process.platform !== 'win32') process.exit(0);

function readArchArgument() {
  const inline = process.argv.find(argument => argument.startsWith('--arch='));
  if (inline) return inline.slice('--arch='.length);
  const index = process.argv.indexOf('--arch');
  return index >= 0 ? process.argv[index + 1] : process.arch;
}

const targetArch = readArchArgument();
const architecture = ARCHITECTURES[targetArch];
if (!architecture) {
  console.error(`[TaskbarNative] Unsupported Windows architecture: ${targetArch}`);
  process.exit(1);
}

const projectRoot = process.cwd();
const moduleRoot = path.join(projectRoot, 'native', 'windows-taskbar-native');
const packagePath = path.join(moduleRoot, 'package.json');
const binaryPath = path.join(
  moduleRoot,
  'build',
  'Release',
  'windows_taskbar_native.node',
);
const prebuildDirectory = path.join(
  moduleRoot,
  'prebuilds',
  architecture.directory,
);
const prebuildPath = path.join(prebuildDirectory, architecture.filename);
const metadataPath = path.join(prebuildDirectory, 'metadata.json');
const sourcePaths = [
  path.join(moduleRoot, 'binding.gyp'),
  path.join(moduleRoot, 'src', 'addon.cc'),
];

if (!fs.existsSync(packagePath)) {
  console.error(`[TaskbarNative] Missing source package: ${moduleRoot}`);
  process.exit(1);
}

function sourceHash() {
  const hash = crypto.createHash('sha256');
  for (const sourcePath of sourcePaths) {
    hash.update(path.relative(moduleRoot, sourcePath));
    hash.update('\0');
    hash.update(fs.readFileSync(sourcePath));
    hash.update('\0');
  }
  return hash.digest('hex');
}

function readPeMachine(filePath) {
  try {
    const binary = fs.readFileSync(filePath);
    if (binary.length < 0x40 || binary.readUInt16LE(0) !== 0x5a4d) return null;
    const peOffset = binary.readUInt32LE(0x3c);
    if (peOffset + 6 > binary.length || binary.readUInt32LE(peOffset) !== 0x00004550) {
      return null;
    }
    return binary.readUInt16LE(peOffset + 4);
  } catch {
    return null;
  }
}

function inspectPrebuild() {
  if (readPeMachine(prebuildPath) !== architecture.peMachine) {
    return { current: false, reason: 'binary is missing or has the wrong architecture' };
  }
  try {
    const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
    if (metadata.arch !== targetArch || metadata.nodeApi !== 8) {
      return { current: false, reason: 'metadata is incompatible' };
    }
    if (metadata.sourceHash !== sourceHash()) {
      return { current: false, reason: 'native sources changed' };
    }
    return { current: true, reason: '' };
  } catch {
    return { current: false, reason: 'metadata is missing or invalid' };
  }
}

function probePython(command, prefixArguments = []) {
  const result = spawnSync(command, [
    ...prefixArguments,
    '-c',
    'import os, sys; print(os.path.realpath(sys.executable))',
  ], {
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
  });
  if (result.status !== 0) return null;
  const executable = result.stdout.trim().split(/\r?\n/u).at(-1);
  return executable && fs.existsSync(executable) ? executable : null;
}

function pythonCandidatesFromDirectory(directory) {
  if (!directory || !fs.existsSync(directory)) return [];
  try {
    return fs.readdirSync(directory, { withFileTypes: true })
      .filter(entry => entry.isDirectory() && /^Python/iu.test(entry.name))
      .sort((left, right) => right.name.localeCompare(left.name))
      .map(entry => path.join(directory, entry.name, 'python.exe'));
  } catch {
    return [];
  }
}

function findPython() {
  const configured = [
    process.env.NODE_GYP_FORCE_PYTHON,
    process.env.npm_config_python,
    process.env.PYTHON,
  ].filter(Boolean);
  for (const candidate of configured) {
    const executable = probePython(candidate);
    if (executable) return executable;
  }

  const commands = [
    ['py', ['-3']],
    ['python3', []],
    ['python', []],
  ];
  for (const [command, arguments_] of commands) {
    const executable = probePython(command, arguments_);
    if (executable) return executable;
  }

  const candidates = [
    ...pythonCandidatesFromDirectory(
      process.env.LOCALAPPDATA
        ? path.join(process.env.LOCALAPPDATA, 'Programs', 'Python')
        : '',
    ),
    ...pythonCandidatesFromDirectory(
      process.env.ProgramFiles
        ? path.join(process.env.ProgramFiles, 'Python')
        : '',
    ),
  ];
  for (const candidate of candidates) {
    const executable = probePython(candidate);
    if (executable) return executable;
  }
  return null;
}

const prebuild = inspectPrebuild();
if (!SOURCE_BUILD) {
  if (prebuild.current) {
    console.log(`[TaskbarNative] ${targetArch} Node-API v8 prebuild is current.`);
    process.exit(0);
  }
  const message = `[TaskbarNative] ${targetArch} prebuild unavailable: ${prebuild.reason}.`;
  if (ALLOW_MISSING) {
    console.warn(`${message} Run npm run native:rebuild:taskbar -- --from-source after installing the Windows C++ toolchain and Python 3.`);
    process.exit(0);
  }
  console.error(message);
  console.error('[TaskbarNative] Rebuild it explicitly with: npm run native:rebuild:taskbar -- --from-source');
  process.exit(1);
}

const python = findPython();
if (!python) {
  console.error('[TaskbarNative] Python 3 is required only for an explicit source rebuild.');
  console.error('[TaskbarNative] Install Python 3 or set PYTHON / npm_config_python to python.exe.');
  process.exit(1);
}

const nodeModulesPackage = path.join(
  projectRoot,
  'node_modules',
  '@lyrics-adapter',
  'windows-taskbar-native',
  'package.json',
);
if (!fs.existsSync(nodeModulesPackage)) {
  console.error(`[TaskbarNative] Missing installed optional dependency: ${PACKAGE_NAME}`);
  process.exit(1);
}

const electronVersion = require('electron/package.json').version;
const rebuildMain = require.resolve('@electron/rebuild');
const rebuildCli = path.join(path.dirname(rebuildMain), 'cli.js');
const nodeOptions = [
  process.env.NODE_OPTIONS,
  '--disable-warning=DEP0190',
].filter(Boolean).join(' ');
const result = spawnSync(process.execPath, [
  rebuildCli,
  '--force',
  '--build-from-source',
  '--disable-pre-gyp-copy',
  '--only',
  PACKAGE_NAME,
  '--arch',
  targetArch,
], {
  cwd: projectRoot,
  env: {
    ...process.env,
    NODE_GYP_FORCE_PYTHON: python,
    PYTHON: python,
    npm_config_python: python,
    NODE_OPTIONS: nodeOptions,
  },
  stdio: 'inherit',
  windowsHide: true,
});

if (result.error) {
  console.error('[TaskbarNative] Failed to start electron-rebuild:', result.error);
  process.exit(1);
}
if (result.status !== 0) process.exit(result.status ?? 1);

if (readPeMachine(binaryPath) !== architecture.peMachine) {
  console.error(`[TaskbarNative] Rebuild did not produce a valid ${targetArch} native module.`);
  process.exit(1);
}

fs.mkdirSync(prebuildDirectory, { recursive: true });
fs.copyFileSync(binaryPath, prebuildPath);
fs.writeFileSync(metadataPath, `${JSON.stringify({
  arch: targetArch,
  nodeApi: 8,
  electronVersionUsedToBuild: electronVersion,
  sourceHash: sourceHash(),
}, null, 2)}\n`, 'utf8');
console.log(`[TaskbarNative] Wrote ${targetArch} Node-API prebuild: ${prebuildPath}`);
