const { spawnSync } = require('node:child_process');
const path = require('node:path');

const requested = process.argv.find(argument => argument.startsWith('--arch='))?.slice('--arch='.length)
  ?? 'current';
if (requested === 'current' && process.platform !== 'win32') {
  process.exit(0);
}

const architecture = requested === 'current' ? process.arch : requested;
if (architecture !== 'x64' && architecture !== 'arm64') {
  process.stderr.write(`Unsupported Windows taskbar helper architecture: ${architecture}\n`);
  process.exit(1);
}

const root = path.resolve(__dirname, '..');
const project = path.join(
  root,
  'native',
  'windows-taskbar-lyrics',
  'LyricsAdapter.TaskbarLyrics.csproj',
);
const output = path.join(root, 'dist-native', 'windows-taskbar-lyrics');
const result = spawnSync('dotnet', [
  'publish',
  project,
  '-c', 'Release',
  '-r', `win-${architecture}`,
  '--self-contained', 'true',
  '-p:PublishSingleFile=true',
  '-p:IncludeNativeLibrariesForSelfExtract=true',
  '-p:DebugType=None',
  '-p:DebugSymbols=false',
  '-o', output,
], {
  cwd: root,
  stdio: 'inherit',
  shell: false,
});

if (result.error) {
  process.stderr.write(`Unable to start dotnet: ${result.error.message}\n`);
  process.exit(1);
}
process.exit(result.status ?? 1);
