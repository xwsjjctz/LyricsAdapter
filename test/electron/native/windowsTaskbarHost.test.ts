import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  launchWindowsTaskbarHost,
  parseWindowsTaskbarHostMessage,
  resolveWindowsTaskbarArtworkSource,
  resolveWindowsTaskbarHostExecutablePath,
  WINDOWS_TASKBAR_HOST_EXECUTABLE,
} from '@/../electron/native/windowsTaskbarHost';

const temporaryDirectories: string[] = [];

afterEach(() => {
  vi.useRealTimers();
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe('Windows taskbar host protocol', () => {
  it('accepts only the narrow ready, action, and status message shapes', () => {
    expect(parseWindowsTaskbarHostMessage('{"type":"ready","apiVersion":1}')).toEqual({
      type: 'ready',
      apiVersion: 1,
    });
    expect(parseWindowsTaskbarHostMessage('{"type":"action","action":"next"}')).toEqual({
      type: 'action',
      action: 'next',
    });
    expect(parseWindowsTaskbarHostMessage(JSON.stringify({
      type: 'status',
      attached: true,
      topmost: true,
      reason: 'initial-attach',
      edge: 'bottom',
      dpi: 144,
      boundsPx: { x: 100, y: 20, width: 630, height: 60 },
    }))).toEqual({
      type: 'status',
      attached: true,
      topmost: true,
      reason: 'initial-attach',
      edge: 'bottom',
      dpi: 144,
      boundsPx: { x: 100, y: 20, width: 630, height: 60 },
    });

    expect(parseWindowsTaskbarHostMessage('not-json')).toBeNull();
    expect(parseWindowsTaskbarHostMessage('{"type":"action","action":"delete-library"}')).toBeNull();
    expect(parseWindowsTaskbarHostMessage('{"type":"status","attached":"yes"}')).toBeNull();
  });

  it('resolves development and packaged executables per architecture', () => {
    expect(resolveWindowsTaskbarHostExecutablePath({
      appPath: 'C:\\LyricsAdapter',
      resourcesPath: 'C:\\LyricsAdapter\\resources',
      isPackaged: false,
      arch: 'x64',
    })).toBe(path.join(
      'C:\\LyricsAdapter',
      'native',
      'windows-taskbar-host',
      'publish',
      'win-x64',
      WINDOWS_TASKBAR_HOST_EXECUTABLE,
    ));
    expect(resolveWindowsTaskbarHostExecutablePath({
      appPath: 'C:\\LyricsAdapter',
      resourcesPath: 'C:\\LyricsAdapter\\resources',
      isPackaged: true,
      arch: 'arm64',
    })).toBe(path.join(
      'C:\\LyricsAdapter\\resources',
      'windows-taskbar-host',
      WINDOWS_TASKBAR_HOST_EXECUTABLE,
    ));
    expect(() => resolveWindowsTaskbarHostExecutablePath({
      appPath: 'C:\\LyricsAdapter',
      resourcesPath: 'C:\\LyricsAdapter\\resources',
      isPackaged: false,
      arch: 'ia32',
    })).toThrow('Unsupported Windows taskbar host architecture');
  });

  it('passes HTTPS artwork and maps only safe cover files inside userData', () => {
    const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'lyrics-adapter-host-'));
    temporaryDirectories.push(userData);
    const coverDirectory = path.join(userData, 'covers');
    fs.mkdirSync(coverDirectory);
    fs.writeFileSync(path.join(coverDirectory, 'track-1.jpg'), 'image');

    expect(resolveWindowsTaskbarArtworkSource(
      'https://example.com/cover.jpg',
      userData,
    )).toBe('https://example.com/cover.jpg');
    const localArtwork = resolveWindowsTaskbarArtworkSource(
      'cover://track-1.jpg?v=123',
      userData,
    );
    expect(localArtwork).toMatch(/^file:\/\/\//u);
    expect(new URL(localArtwork).searchParams.get('v')).toBe('123');
    expect(resolveWindowsTaskbarArtworkSource(
      'cover://..%2Fsecret.jpg',
      userData,
    )).toBe('');
    expect(resolveWindowsTaskbarArtworkSource(
      'file:///C:/private.jpg',
      userData,
    )).toBe('');
    expect(resolveWindowsTaskbarArtworkSource(
      'http://example.com/insecure.jpg',
      userData,
    )).toBe('');
  });

  it('terminates a host that never completes the ready handshake', () => {
    vi.useFakeTimers();
    const fakeChild = Object.assign(new EventEmitter(), {
      stdin: new PassThrough(),
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      exitCode: null,
      signalCode: null,
      kill: vi.fn(),
    });
    fakeChild.kill.mockImplementation(() => {
      fakeChild.emit('exit', null, 'SIGTERM');
      return true;
    });
    const onError = vi.fn();
    const onExit = vi.fn();

    launchWindowsTaskbarHost({
      executablePath: 'LyricsAdapter.TaskbarHost.exe',
      spawnHost: () => fakeChild as unknown as ChildProcessWithoutNullStreams,
      callbacks: {
        onReady: vi.fn(),
        onAction: vi.fn(),
        onStatus: vi.fn(),
        onError,
        onExit,
        onStderr: vi.fn(),
      },
    });

    vi.advanceTimersByTime(9_999);
    expect(fakeChild.kill).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);

    expect(onError).toHaveBeenCalledWith(expect.objectContaining({
      message: 'Windows taskbar host timed out before becoming ready.',
    }));
    expect(fakeChild.kill).toHaveBeenCalledOnce();
    expect(onExit).toHaveBeenCalledWith(null, 'SIGTERM');
  });
});
