import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// Compile-time checks cover channel names and payloads wherever the typed
// helpers are used. These source checks make sure nothing bypasses them and
// that the contract has no channel without an implementation.

const root = path.resolve(__dirname, '../../..');
const read = (file: string) => readFileSync(path.join(root, file), 'utf8');

function sourceFiles(dir: string): string[] {
  return readdirSync(path.join(root, dir)).flatMap(name => {
    const relative = path.posix.join(dir, name);
    if (statSync(path.join(root, relative)).isDirectory()) return sourceFiles(relative);
    return relative.endsWith('.ts') ? [relative] : [];
  });
}

function contractKeys(block: string): string[] {
  const source = read('src/shared/ipcContract.ts');
  const start = source.indexOf(`export interface ${block} {`);
  const end = source.indexOf('\n}\n', start);
  return [...source.slice(start, end).matchAll(/^ {2}'([^']+)':/gm)].map(match => match[1]!);
}

const PRELOAD = 'electron/preload.ts';
const HELPERS = 'electron/ipc/ipcMainTyped.ts';
const mainFiles = sourceFiles('electron').filter(file => file !== PRELOAD && file !== HELPERS);
const mainSource = mainFiles.map(read).join('\n');
const preload = read(PRELOAD);

describe('IPC contract', () => {
  it('registers and emits main-process IPC only through the typed helpers', () => {
    const offenders = mainFiles.filter(file => /ipcMain\.(handle|handleOnce|on|once)\(|\.send\(['"`]/.test(read(file)));
    expect(offenders).toEqual([]);
  });

  it('keeps raw ipcRenderer calls inside the preload helpers', () => {
    expect(preload.match(/ipcRenderer\.invoke\(/g)).toHaveLength(1);
    expect(preload.match(/ipcRenderer\.send\(/g)).toHaveLength(1);
    expect(preload.match(/ipcRenderer\.on\(/g)).toHaveLength(1);
  });

  it('implements every invoke and send channel in the main process', () => {
    const missing = [...contractKeys('IpcInvokeContract'), ...contractKeys('IpcSendContract')]
      .filter(channel => !mainSource.includes(`'${channel}'`));
    expect(missing).toEqual([]);
  });

  it('exposes every invoke channel and event through the preload', () => {
    const channels = [...contractKeys('IpcInvokeContract'), ...contractKeys('IpcEventContract'), ...contractKeys('IpcSendContract')];
    expect(channels.filter(channel => !preload.includes(`'${channel}'`))).toEqual([]);
  });
});
