import { app } from 'electron';
import path from 'path';
import { spawnSync } from 'child_process';

export function isCommandAvailable(command: string, versionArg: string): boolean {
  try {
    const result = spawnSync(command, [versionArg], {
      stdio: 'ignore',
      windowsHide: true,
    });
    return result.status === 0;
  } catch {
    return false;
  }
}

export function getBundledBinaryPath(tool: 'metaflac' | 'ffmpeg', appDir: string): string {
  const platform = process.platform;
  const arch = process.arch;
  const fileName = platform === 'win32' ? `${tool}.exe` : tool;

  if (platform === 'darwin') {
    if (arch === 'arm64') {
      return app.isPackaged
        ? path.join(process.resourcesPath, 'binaries', 'darwin-arm64', fileName)
        : path.join(appDir, '../binaries/darwin-arm64', fileName);
    }
    return app.isPackaged
      ? path.join(process.resourcesPath, 'binaries', 'darwin-x64', fileName)
      : path.join(appDir, '../binaries/darwin-x64', fileName);
  }

  if (platform === 'win32') {
    return app.isPackaged
      ? path.join(process.resourcesPath, 'binaries', 'win32-x64', fileName)
      : path.join(appDir, '../binaries/win32-x64', fileName);
  }

  if (platform === 'linux') {
    return app.isPackaged
      ? path.join(process.resourcesPath, 'binaries', 'linux-x64', fileName)
      : path.join(appDir, '../binaries/linux-x64', fileName);
  }

  throw new Error(`Unsupported platform: ${platform}-${arch}`);
}

export async function runCommand(command: string, args: string[]): Promise<void> {
  const { spawn } = await import('child_process');
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stderr = '';
    child.stderr.on('data', chunk => {
      stderr += chunk.toString();
    });

    child.on('error', reject);
    child.on('close', code => {
      if (code === 0) {
        resolve();
        return;
      }
      const trimmed = stderr.trim();
      reject(new Error(trimmed || `${command} exited with code ${code}`));
    });
  });
}