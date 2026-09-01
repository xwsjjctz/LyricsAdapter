'use strict';

const path = require('node:path');
const readline = require('node:readline');
const { spawn } = require('node:child_process');

if (process.platform !== 'win32') process.exit(0);

const archArgument = process.argv.find(argument => argument.startsWith('--arch='));
const targetArch = archArgument ? archArgument.slice('--arch='.length) : process.arch;
const testAttachment = process.argv.includes('--attach');
const executableArgument = process.argv.find(argument => argument.startsWith('--executable='));
const holdArgument = process.argv.find(argument => argument.startsWith('--hold-ms='));
const requestedHoldMs = holdArgument ? Number(holdArgument.slice('--hold-ms='.length)) : 0;
const holdMs = Number.isFinite(requestedHoldMs)
  ? Math.min(30_000, Math.max(0, Math.floor(requestedHoldMs)))
  : 0;
if (!['x64', 'arm64'].includes(targetArch)) {
  console.error(`[TaskbarHostSmoke] Unsupported architecture: ${targetArch}`);
  process.exit(1);
}

const executablePath = executableArgument
  ? path.resolve(executableArgument.slice('--executable='.length))
  : path.join(
    process.cwd(),
    'native',
    'windows-taskbar-host',
    'publish',
    `win-${targetArch}`,
    'LyricsAdapter.TaskbarHost.exe',
  );
const child = spawn(executablePath, ['--protocol-version', '1'], {
  windowsHide: true,
  shell: false,
  stdio: ['pipe', 'pipe', 'pipe'],
});
const stdout = readline.createInterface({ input: child.stdout });
const stderr = readline.createInterface({ input: child.stderr });
let ready = false;
let statusSeen = false;
let attachmentPassed = false;
let attachmentSummary = '';
let stderrText = '';

const timeout = setTimeout(() => {
  console.error('[TaskbarHostSmoke] Timed out waiting for the WPF host.');
  child.kill();
}, 10_000 + holdMs);

stderr.on('line', line => {
  stderrText += `${line}\n`;
});
stdout.on('line', line => {
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    console.error(`[TaskbarHostSmoke] Invalid stdout message: ${line}`);
    child.kill();
    return;
  }
  if (message.type === 'ready' && message.apiVersion === 1 && !ready) {
    ready = true;
    if (!testAttachment) {
      child.stdin.end(`${JSON.stringify({ type: 'shutdown' })}\n`);
      return;
    }
    child.stdin.write(`${JSON.stringify({
      type: 'update',
      state: {
        artworkSource: '',
        title: 'LyricsAdapter',
        artist: 'Native host smoke test',
        line: 'Windows 原生任务栏歌词',
        nextLine: '验证完成后会自动关闭',
        lineCursor: 0,
        lineProgress: 6,
        isPlaying: true,
      },
    })}\n`);
    return;
  }
  if (testAttachment && message.type === 'status' && !statusSeen) {
    statusSeen = true;
    attachmentPassed = message.attached === true && message.topmost === true;
    attachmentSummary = `attached=${Boolean(message.attached)}, topmost=${Boolean(message.topmost)}, reason=${String(message.reason)}`;
    const shutdown = () => child.stdin.end(`${JSON.stringify({ type: 'shutdown' })}\n`);
    if (holdMs > 0) setTimeout(shutdown, holdMs);
    else shutdown();
  }
});
child.on('error', error => {
  clearTimeout(timeout);
  console.error('[TaskbarHostSmoke] Failed to launch:', error);
  process.exitCode = 1;
});
child.on('close', code => {
  clearTimeout(timeout);
  stdout.close();
  stderr.close();
  if (!ready || (testAttachment && (!statusSeen || !attachmentPassed)) || code !== 0) {
    console.error(`[TaskbarHostSmoke] Host failed (ready=${ready}, status=${statusSeen}, attachment=${attachmentPassed}, code=${code}).`);
    if (stderrText) console.error(stderrText.trim());
    process.exitCode = 1;
    return;
  }
  console.log(`[TaskbarHostSmoke] Ready/shutdown protocol passed${attachmentSummary ? ` (${attachmentSummary})` : ''}.`);
});
