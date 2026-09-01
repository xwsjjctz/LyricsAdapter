'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const FORCE_BUILD = process.argv.includes('--force');
const ARCHITECTURES = {
  x64: { runtime: 'win-x64', peMachine: 0x8664 },
  arm64: { runtime: 'win-arm64', peMachine: 0xaa64 },
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
  console.error(`[TaskbarHost] Unsupported Windows architecture: ${targetArch}`);
  process.exit(1);
}

const projectRoot = process.cwd();
const sourceRoot = path.join(projectRoot, 'native', 'windows-taskbar-host');
const projectPath = path.join(sourceRoot, 'LyricsAdapter.TaskbarHost.csproj');
const outputRoot = path.join(sourceRoot, 'publish', architecture.runtime);
const executablePath = path.join(outputRoot, 'LyricsAdapter.TaskbarHost.exe');
const metadataPath = path.join(outputRoot, '.lyrics-adapter-host.json');

function collectSourceFiles(directory) {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (['bin', 'obj', 'publish'].includes(entry.name)) continue;
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...collectSourceFiles(entryPath));
    else if (/\.(?:cs|csproj|xaml|manifest)$/iu.test(entry.name)) files.push(entryPath);
  }
  return files.sort();
}

function sourceHash() {
  const hash = crypto.createHash('sha256');
  for (const sourcePath of collectSourceFiles(sourceRoot)) {
    hash.update(path.relative(sourceRoot, sourcePath));
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

function dotnetVersion() {
  const result = spawnSync('dotnet', ['--version'], {
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
  });
  if (result.status !== 0) {
    console.error('[TaskbarHost] .NET 8 SDK is required to build the Windows taskbar host.');
    process.exit(1);
  }
  return result.stdout.trim();
}

const sdkVersion = dotnetVersion();
const hash = sourceHash();
if (!FORCE_BUILD && readPeMachine(executablePath) === architecture.peMachine) {
  try {
    const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
    if (
      metadata.arch === targetArch
      && metadata.runtime === architecture.runtime
      && metadata.sdkVersion === sdkVersion
      && metadata.sourceHash === hash
    ) {
      console.log(`[TaskbarHost] ${architecture.runtime} build is current.`);
      process.exit(0);
    }
  } catch {
    // Rebuild when metadata is absent or malformed.
  }
}

fs.mkdirSync(outputRoot, { recursive: true });
console.log(`[TaskbarHost] Publishing self-contained WPF host for ${architecture.runtime}.`);
const result = spawnSync('dotnet', [
  'publish',
  projectPath,
  '--configuration',
  'Release',
  '--runtime',
  architecture.runtime,
  '--self-contained',
  'true',
  '--output',
  outputRoot,
  '-p:PublishSingleFile=true',
  '-p:IncludeNativeLibrariesForSelfExtract=true',
  '-p:PublishTrimmed=false',
  '-p:DebugType=None',
  '-p:DebugSymbols=false',
], {
  cwd: projectRoot,
  stdio: 'inherit',
  shell: false,
  windowsHide: true,
});

if (result.error) {
  console.error('[TaskbarHost] Failed to start dotnet publish:', result.error);
  process.exit(1);
}
if (result.status !== 0) process.exit(result.status ?? 1);
if (readPeMachine(executablePath) !== architecture.peMachine) {
  console.error(`[TaskbarHost] Publish did not produce a valid ${targetArch} executable.`);
  process.exit(1);
}

fs.writeFileSync(metadataPath, `${JSON.stringify({
  arch: targetArch,
  runtime: architecture.runtime,
  sdkVersion,
  sourceHash: hash,
}, null, 2)}\n`, 'utf8');
console.log(`[TaskbarHost] Ready: ${executablePath}`);
