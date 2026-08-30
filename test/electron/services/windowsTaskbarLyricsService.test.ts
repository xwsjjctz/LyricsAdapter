import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const loggerMocks = vi.hoisted(() => ({
  error: vi.fn(),
  warn: vi.fn(),
}));

vi.mock('@/../electron/logger', () => ({ logger: loggerMocks }));
vi.mock('electron', () => ({ app: { isPackaged: false } }));

import {
  WindowsTaskbarLyricsService,
  resolveWindowsTaskbarLyricsHelperPath,
  type WindowsTaskbarLyricsServiceDependencies,
} from '@/../electron/services/windowsTaskbarLyricsService';

class FakeHelper extends EventEmitter {
  readonly stdin = new PassThrough();
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  killed = false;
  readonly kill = vi.fn(() => {
    this.killed = true;
    return true;
  });
}

function testDependencies(
  helper: FakeHelper,
  overrides: Partial<WindowsTaskbarLyricsServiceDependencies> = {},
): WindowsTaskbarLyricsServiceDependencies {
  return {
    platform: 'win32',
    arch: 'x64',
    isPackaged: false,
    cwd: () => 'C:\\LyricsAdapter',
    env: {},
    resourcesPath: 'C:\\Program Files\\LyricsAdapter\\resources',
    fileExists: () => true,
    spawnHelper: vi.fn(() => helper),
    ...overrides,
  };
}

function readWrites(stream: PassThrough): string[] {
  return stream.readableLength > 0
    ? stream.read().toString('utf8').trim().split('\n') as string[]
    : [];
}

const PLAYING_STATE = {
  trackId: 'track-1',
  title: '测试歌曲',
  artist: '测试歌手',
  line: '当前歌词',
  lineCursor: 0,
  nextLine: '下一行',
  isPlaying: true,
};

describe('WindowsTaskbarLyricsService', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.useRealTimers());

  it('does not spawn outside Windows', () => {
    const helper = new FakeHelper();
    const dependencies = testDependencies(helper, { platform: 'darwin' });
    const service = new WindowsTaskbarLyricsService(dependencies);

    expect(service.start(vi.fn())).toBe(false);
    service.update(PLAYING_STATE);

    expect(dependencies.spawnHelper).not.toHaveBeenCalled();
  });

  it('starts once and sends state snapshots as NDJSON', () => {
    const helper = new FakeHelper();
    const dependencies = testDependencies(helper);
    const service = new WindowsTaskbarLyricsService(dependencies);

    expect(service.start(vi.fn())).toBe(true);
    expect(service.start(vi.fn())).toBe(true);
    service.update(PLAYING_STATE);

    expect(dependencies.spawnHelper).toHaveBeenCalledOnce();
    expect(readWrites(helper.stdin)).toEqual([
      JSON.stringify({ type: 'update', state: PLAYING_STATE }),
    ]);
  });

  it('parses fragmented action messages and uses the latest handler', () => {
    const helper = new FakeHelper();
    const firstHandler = vi.fn();
    const replacementHandler = vi.fn();
    const service = new WindowsTaskbarLyricsService(testDependencies(helper));
    service.start(firstHandler);
    service.start(replacementHandler);

    helper.stdout.write('{"type":"action","action":"tog');
    helper.stdout.write('gle-play"}\n{"type":"action","action":"next"}\n');

    expect(firstHandler).not.toHaveBeenCalled();
    expect(replacementHandler.mock.calls).toEqual([
      ['toggle-play'],
      ['next'],
    ]);
  });

  it('ignores unknown and malformed helper messages', () => {
    const helper = new FakeHelper();
    const onAction = vi.fn();
    const service = new WindowsTaskbarLyricsService(testDependencies(helper));
    service.start(onAction);

    helper.stdout.write('{"type":"action","action":"delete-library"}\n');
    helper.stdout.write('not json\n');

    expect(onAction).not.toHaveBeenCalled();
    expect(loggerMocks.warn).toHaveBeenCalledOnce();
  });

  it('sends stop, closes stdin, and clears callbacks', () => {
    vi.useFakeTimers();
    const helper = new FakeHelper();
    const onAction = vi.fn();
    const service = new WindowsTaskbarLyricsService(testDependencies(helper));
    service.start(onAction);

    service.stop();
    expect(readWrites(helper.stdin)).toEqual([JSON.stringify({ type: 'stop' })]);
    expect(helper.stdin.writableEnded).toBe(true);

    helper.stdout.write('{"type":"action","action":"next"}\n');
    expect(onAction).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1_500);
    expect(helper.kill).toHaveBeenCalledOnce();
  });

  it('keeps only the latest update while helper stdin is backpressured', () => {
    const helper = new FakeHelper();
    const writes: string[] = [];
    const writeSpy = vi.spyOn(helper.stdin, 'write');
    writeSpy.mockImplementation(((chunk: string | Uint8Array) => {
      writes.push(chunk.toString());
      return writes.length !== 1;
    }) as typeof helper.stdin.write);
    const service = new WindowsTaskbarLyricsService(testDependencies(helper));
    service.start(vi.fn());

    service.update({ ...PLAYING_STATE, line: 'line 1' });
    service.update({ ...PLAYING_STATE, line: 'line 2' });
    service.update({ ...PLAYING_STATE, line: 'line 3' });

    expect(writes).toHaveLength(1);
    expect(JSON.parse(writes[0]!)['state']['line']).toBe('line 1');

    helper.stdin.emit('drain');

    expect(writes).toHaveLength(2);
    expect(JSON.parse(writes[1]!)['state']['line']).toBe('line 3');
    service.stop();
    helper.emit('exit', 0, null);
  });

  it('sends stop ahead of an unsent update while backpressured', () => {
    const helper = new FakeHelper();
    const writes: string[] = [];
    const writeSpy = vi.spyOn(helper.stdin, 'write');
    writeSpy.mockImplementation(((chunk: string | Uint8Array) => {
      writes.push(chunk.toString());
      return writes.length !== 1;
    }) as typeof helper.stdin.write);
    const service = new WindowsTaskbarLyricsService(testDependencies(helper));
    service.start(vi.fn());

    service.update({ ...PLAYING_STATE, line: 'accepted but buffered' });
    service.update({ ...PLAYING_STATE, line: 'must be discarded' });
    service.stop();

    expect(writes.map(line => JSON.parse(line)['type'])).toEqual(['update', 'stop']);
    helper.stdin.emit('drain');
    expect(writes).toHaveLength(2);
    helper.emit('exit', 0, null);
  });

  it('coalesces updates during exponential restart delays', () => {
    vi.useFakeTimers();
    const helpers = [new FakeHelper(), new FakeHelper(), new FakeHelper()];
    let helperIndex = 0;
    const spawnHelper = vi.fn(() => helpers[helperIndex++]!);
    const dependencies = testDependencies(helpers[0]!, { spawnHelper });
    const service = new WindowsTaskbarLyricsService(dependencies);
    service.start(vi.fn());
    service.update({ ...PLAYING_STATE, line: 'initial' });

    helpers[0]!.emit('exit', 1, null);
    service.update({ ...PLAYING_STATE, line: 'stale retry state' });
    service.update({ ...PLAYING_STATE, line: 'latest retry state' });
    vi.advanceTimersByTime(499);
    expect(spawnHelper).toHaveBeenCalledOnce();

    vi.advanceTimersByTime(1);
    expect(spawnHelper).toHaveBeenCalledTimes(2);
    const secondWrites = readWrites(helpers[1]!.stdin);
    expect(JSON.parse(secondWrites[0]!)['state']['line']).toBe('latest retry state');

    helpers[1]!.emit('exit', 1, null);
    vi.advanceTimersByTime(999);
    expect(spawnHelper).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(1);
    expect(spawnHelper).toHaveBeenCalledTimes(3);

    service.stop();
    helpers[2]!.emit('exit', 0, null);
  });

  it('caps repeated helper restart delays at thirty seconds', () => {
    vi.useFakeTimers();
    const expectedDelays = [500, 1_000, 2_000, 4_000, 8_000, 16_000, 30_000, 30_000];
    const helpers = expectedDelays.map(() => new FakeHelper());
    helpers.push(new FakeHelper());
    let helperIndex = 0;
    const spawnHelper = vi.fn(() => helpers[helperIndex++]!);
    const service = new WindowsTaskbarLyricsService(
      testDependencies(helpers[0]!, { spawnHelper }),
    );
    service.start(vi.fn());
    service.update(PLAYING_STATE);

    expectedDelays.forEach((delay, index) => {
      helpers[index]!.emit('exit', 1, null);
      vi.advanceTimersByTime(delay - 1);
      expect(spawnHelper).toHaveBeenCalledTimes(index + 1);
      vi.advanceTimersByTime(1);
      expect(spawnHelper).toHaveBeenCalledTimes(index + 2);
    });

    service.stop();
    helpers.at(-1)!.emit('exit', 0, null);
  });

  it('returns false without a published helper', () => {
    const helper = new FakeHelper();
    const dependencies = testDependencies(helper, { fileExists: () => false });
    const service = new WindowsTaskbarLyricsService(dependencies);

    expect(service.start(vi.fn())).toBe(false);
    expect(dependencies.spawnHelper).not.toHaveBeenCalled();
    expect(loggerMocks.warn).toHaveBeenCalledOnce();
  });
});

describe('resolveWindowsTaskbarLyricsHelperPath', () => {
  it('prefers an explicit helper override', () => {
    const path = resolveWindowsTaskbarLyricsHelperPath({
      arch: 'x64',
      isPackaged: false,
      cwd: () => 'C:\\repo',
      env: { LYRICS_ADAPTER_TASKBAR_LYRICS_HELPER: 'C:\\custom\\lyrics.exe' },
      resourcesPath: 'C:\\resources',
      fileExists: candidate => candidate.includes('custom'),
    });

    expect(path).toContain('custom');
    expect(path).toContain('lyrics.exe');
  });

  it('finds the helper published by the local Windows build script', () => {
    const path = resolveWindowsTaskbarLyricsHelperPath({
      arch: 'x64',
      isPackaged: false,
      cwd: () => 'C:\\repo',
      env: {},
      resourcesPath: undefined,
      fileExists: candidate => candidate.includes('dist-native'),
    });

    expect(path?.replaceAll('\\', '/')).toBe(
      'C:/repo/dist-native/windows-taskbar-lyrics/LyricsAdapter.TaskbarLyrics.exe',
    );
  });

  it('uses only the fixed resources helper in packaged applications', () => {
    const inspected: string[] = [];
    const path = resolveWindowsTaskbarLyricsHelperPath({
      arch: 'x64',
      isPackaged: true,
      cwd: () => 'C:\\attacker-controlled-cwd',
      env: { LYRICS_ADAPTER_TASKBAR_LYRICS_HELPER: 'C:\\override\\lyrics.exe' },
      resourcesPath: 'C:\\Program Files\\LyricsAdapter\\resources',
      fileExists: candidate => {
        inspected.push(candidate);
        return candidate.includes('attacker-controlled-cwd') || candidate.includes('override');
      },
    });

    expect(path).toBeNull();
    expect(inspected).toHaveLength(1);
    expect(inspected[0]?.replaceAll('\\', '/')).toBe(
      'C:/Program Files/LyricsAdapter/resources/native/windows-taskbar-lyrics/LyricsAdapter.TaskbarLyrics.exe',
    );
  });

  it('resolves the fixed resources helper when packaged', () => {
    const path = resolveWindowsTaskbarLyricsHelperPath({
      arch: 'arm64',
      isPackaged: true,
      cwd: () => 'C:\\ignored',
      env: { LYRICS_ADAPTER_TASKBAR_LYRICS_HELPER: 'C:\\ignored\\helper.exe' },
      resourcesPath: 'D:\\Apps\\LyricsAdapter\\resources',
      fileExists: () => true,
    });

    expect(path?.replaceAll('\\', '/')).toBe(
      'D:/Apps/LyricsAdapter/resources/native/windows-taskbar-lyrics/LyricsAdapter.TaskbarLyrics.exe',
    );
  });
});
