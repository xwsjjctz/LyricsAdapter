'use strict';

const path = require('node:path');
const readline = require('node:readline');
const { spawn } = require('node:child_process');

if (process.platform !== 'win32') process.exit(0);

const archArgument = process.argv.find(argument => argument.startsWith('--arch='));
const targetArch = archArgument ? archArgument.slice('--arch='.length) : process.arch;
const testAttachment = process.argv.includes('--attach');
const verifyLyricEnd = process.argv.includes('--verify-lyric-end');
const executableArgument = process.argv.find(argument => argument.startsWith('--executable='));
const holdArgument = process.argv.find(argument => argument.startsWith('--hold-ms='));
const expectedWidthArgument = process.argv.find(argument => argument.startsWith('--expected-width-dip='));
const manualPositionArgument = process.argv.find(argument => argument.startsWith('--manual-position='));
const requestedHoldMs = holdArgument ? Number(holdArgument.slice('--hold-ms='.length)) : 0;
const requestedExpectedWidthDip = expectedWidthArgument
  ? Number(expectedWidthArgument.slice('--expected-width-dip='.length))
  : null;
const expectedWidthDip = requestedExpectedWidthDip !== null
  && Number.isFinite(requestedExpectedWidthDip)
  && requestedExpectedWidthDip > 0
  ? requestedExpectedWidthDip
  : null;
const requestedManualPosition = manualPositionArgument
  ? Number(manualPositionArgument.slice('--manual-position='.length))
  : null;
const manualPosition = requestedManualPosition !== null
  && Number.isFinite(requestedManualPosition)
  && requestedManualPosition >= 0
  && requestedManualPosition <= 1
  ? requestedManualPosition
  : null;
const holdMs = Number.isFinite(requestedHoldMs)
  ? Math.min(30_000, Math.max(0, Math.floor(requestedHoldMs)))
  : 0;
if (!['x64', 'arm64'].includes(targetArch)) {
  console.error(`[TaskbarHostSmoke] Unsupported architecture: ${targetArch}`);
  process.exit(1);
}
const lyricEndFixture = "the maiden who's blessed";

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
const child = spawn(executablePath, ['--protocol-version', '2'], {
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
let lyricDiagnosticsSeen = false;
let lyricDiagnosticsPassed = !verifyLyricEnd;
let lyricDiagnosticsSummary = '';
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
  if (message.type === 'ready' && message.apiVersion === 2 && !ready) {
    ready = true;
    if (!testAttachment && !verifyLyricEnd) {
      child.stdin.end(`${JSON.stringify({ type: 'shutdown' })}\n`);
      return;
    }
    child.stdin.write(`${JSON.stringify({
      type: 'update',
      state: {
        artworkSource: '',
        title: 'LyricsAdapter',
        artist: 'Native host smoke test',
        line: verifyLyricEnd ? lyricEndFixture : 'Windows 原生任务栏歌词',
        nextLine: '验证完成后会自动关闭',
        lineCursor: verifyLyricEnd ? null : 0,
        lineProgress: verifyLyricEnd ? Array.from(lyricEndFixture).length : 6,
        isPlaying: true,
        placementMode: manualPosition === null ? 'auto' : 'manual',
        manualPosition,
      },
    })}\n`);
    if (verifyLyricEnd && !testAttachment) {
      setTimeout(() => {
        child.stdin.write(`${JSON.stringify({ type: 'inspect-current-lyric' })}\n`);
      }, 100);
    }
    return;
  }
  if (testAttachment && message.type === 'status' && !statusSeen) {
    statusSeen = true;
    const dpi = Number(message.dpi);
    const actualWidth = Number(message.boundsPx?.width);
    const expectedWidth = expectedWidthDip === null || !Number.isFinite(dpi)
      ? null
      : Math.round(expectedWidthDip * dpi / 96);
    const widthPassed = expectedWidth === null
      || (Number.isFinite(actualWidth) && Math.abs(actualWidth - expectedWidth) <= 1);
    const placementPassed = manualPosition === null
      ? message.placementMode === 'auto'
      : message.placementMode === 'manual'
        && Number.isFinite(Number(message.manualPosition))
        && Math.abs(Number(message.manualPosition) - manualPosition) <= 0.0001;
    attachmentPassed = message.attached === true
      && message.topmost === true
      && widthPassed
      && placementPassed;
    attachmentSummary = [
      `attached=${Boolean(message.attached)}`,
      `topmost=${Boolean(message.topmost)}`,
      `x=${Number.isFinite(Number(message.boundsPx?.x)) ? Number(message.boundsPx.x) : 'unknown'}`,
      `width=${Number.isFinite(actualWidth) ? actualWidth : 'unknown'}`,
      `expectedWidth=${expectedWidth ?? 'not-checked'}`,
      `placement=${String(message.placementMode ?? 'unknown')}`,
      `occupiedRegions=${Number.isFinite(Number(message.occupiedRegionCount)) ? Number(message.occupiedRegionCount) : 'unknown'}`,
      `reason=${String(message.reason)}`,
    ].join(', ');
    const shutdown = () => child.stdin.end(`${JSON.stringify({ type: 'shutdown' })}\n`);
    if (verifyLyricEnd && attachmentPassed) {
      setTimeout(() => {
        child.stdin.write(`${JSON.stringify({ type: 'inspect-current-lyric' })}\n`);
      }, 100);
      return;
    }
    if (holdMs > 0) setTimeout(shutdown, holdMs);
    else shutdown();
    return;
  }
  if (
    verifyLyricEnd
    && message.type === 'current-lyric-diagnostics'
    && !lyricDiagnosticsSeen
  ) {
    lyricDiagnosticsSeen = true;
    const offset = Number(message.offset);
    const maximumOffset = Number(message.maximumOffset);
    const viewportWidth = Number(message.viewportWidth);
    const extentWidth = Number(message.extentWidth);
    lyricDiagnosticsPassed = message.text === lyricEndFixture
      && message.textTrimming === 'None'
      && Number.isFinite(offset)
      && Number.isFinite(maximumOffset)
      && maximumOffset > 1
      && Math.abs(offset - maximumOffset) <= 0.5
      && message.atEnd === true;
    lyricDiagnosticsSummary = [
      `text=${JSON.stringify(String(message.text ?? ''))}`,
      `trimming=${String(message.textTrimming ?? 'unknown')}`,
      `offset=${Number.isFinite(offset) ? offset.toFixed(2) : 'unknown'}`,
      `maximumOffset=${Number.isFinite(maximumOffset) ? maximumOffset.toFixed(2) : 'unknown'}`,
      `viewportWidth=${Number.isFinite(viewportWidth) ? viewportWidth.toFixed(2) : 'unknown'}`,
      `extentWidth=${Number.isFinite(extentWidth) ? extentWidth.toFixed(2) : 'unknown'}`,
      `atEnd=${Boolean(message.atEnd)}`,
    ].join(', ');
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
  if (
    !ready
    || (testAttachment && (!statusSeen || !attachmentPassed))
    || (verifyLyricEnd && (!lyricDiagnosticsSeen || !lyricDiagnosticsPassed))
    || code !== 0
  ) {
    console.error(`[TaskbarHostSmoke] Host failed (ready=${ready}, status=${statusSeen}, attachment=${attachmentPassed}, lyricDiagnostics=${lyricDiagnosticsPassed}, code=${code}${attachmentSummary ? `, ${attachmentSummary}` : ''}${lyricDiagnosticsSummary ? `, ${lyricDiagnosticsSummary}` : ''}).`);
    if (stderrText) console.error(stderrText.trim());
    process.exitCode = 1;
    return;
  }
  console.log(`[TaskbarHostSmoke] Ready/shutdown protocol passed${attachmentSummary || lyricDiagnosticsSummary ? ` (${[attachmentSummary, lyricDiagnosticsSummary].filter(Boolean).join(', ')})` : ''}.`);
});
