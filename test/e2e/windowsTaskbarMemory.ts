import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface TaskbarMemorySnapshot {
  status: 'available' | 'unavailable' | 'not-applicable';
  processes: Array<{
    pid: number;
    privateBytes: number;
    workingSetBytes: number;
    privateWorkingSetBytes: number | null;
  }>;
  error?: string;
}

/** app.getAppMetrics excludes the WPF process spawned outside Chromium. */
export async function collectTaskbarMemory(browserPid: number): Promise<TaskbarMemorySnapshot> {
  if (process.platform !== 'win32') return { status: 'not-applicable', processes: [] };
  if (!Number.isSafeInteger(browserPid) || browserPid <= 0) {
    return { status: 'unavailable', processes: [], error: 'Invalid Electron process ID' };
  }
  // Scope by parent PID so another running installation is never counted.
  // Encode the script rather than passing shell-interpolated command text.
  const script = `
$ErrorActionPreference = 'Stop'
$hosts = @(Get-CimInstance Win32_Process -Filter "ParentProcessId = ${browserPid} AND Name = 'LyricsAdapter.TaskbarHost.exe'")
$privateSets = @{}
try {
  Get-CimInstance Win32_PerfFormattedData_PerfProc_Process -Filter "Name LIKE 'LyricsAdapter.TaskbarHost%'" | ForEach-Object { $privateSets[[int]$_.IDProcess] = [double]$_.WorkingSetPrivate }
} catch { }
$rows = @($hosts | ForEach-Object {
  $p = Get-Process -Id $_.ProcessId -ErrorAction Stop
  @{ pid=$p.Id; privateBytes=[double]$p.PrivateMemorySize64; workingSetBytes=[double]$p.WorkingSet64; privateWorkingSetBytes=$privateSets[$p.Id] }
})
ConvertTo-Json -InputObject $rows -Compress
`;
  try {
    const { stdout } = await execFileAsync('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64'),
    ], { windowsHide: true, timeout: 8_000, maxBuffer: 1024 * 1024 });
    const processes = JSON.parse(stdout.trim().replace(/^\uFEFF/, '')) as TaskbarMemorySnapshot['processes'];
    return { status: 'available', processes };
  } catch (error) {
    // Restricted desktops may deny CIM access. Never report that as zero usage.
    return { status: 'unavailable', processes: [], error: error instanceof Error ? error.message : String(error) };
  }
}
