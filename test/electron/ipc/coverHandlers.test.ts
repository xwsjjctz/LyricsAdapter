import fs from 'fs';
import os from 'os';
import path from 'path';
import { createHash } from 'crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const electronMocks = vi.hoisted(() => ({
  handle: vi.fn(),
  getPath: vi.fn(),
  createFromPath: vi.fn(),
}));

vi.mock('electron', () => ({
  app: {
    getPath: electronMocks.getPath,
    whenReady: vi.fn(() => Promise.resolve()),
  },
  ipcMain: { handle: electronMocks.handle },
  nativeImage: { createFromPath: electronMocks.createFromPath },
  protocol: { handle: vi.fn() },
}));
vi.mock('../../../electron/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { registerCoverHandlers } from '../../../electron/ipc/coverHandlers';
import { ensureCoverThumbnailCache } from '../../../electron/protocols/coverProtocol';

type Handler = (_event: unknown, ...args: any[]) => Promise<any>;

function registeredHandler(channel: string): Handler {
  const match = electronMocks.handle.mock.calls.find(([name]) => name === channel);
  if (!match) throw new Error(`Missing handler for ${channel}`);
  return match[1] as Handler;
}

describe('cover IPC cache invalidation', () => {
  let userDataDirectory = '';
  let coverDirectory = '';

  beforeEach(() => {
    userDataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'lyrics-adapter-cover-ipc-'));
    coverDirectory = path.join(userDataDirectory, 'covers');
    fs.mkdirSync(coverDirectory);
    electronMocks.getPath.mockReturnValue(userDataDirectory);
    electronMocks.createFromPath.mockReturnValue({
      isEmpty: () => false,
      getSize: () => ({ width: 1000, height: 1000 }),
      resize: () => ({ toJPEG: () => Buffer.from('derived jpeg') }),
    });
    registerCoverHandlers();
  });

  afterEach(() => {
    vi.clearAllMocks();
    fs.rmSync(userDataDirectory, { recursive: true, force: true });
  });

  it('atomically replaces a source, invalidates derivatives, and returns a content-versioned URL', async () => {
    const coverPath = path.join(coverDirectory, 'track-id.jpg');
    fs.writeFileSync(coverPath, 'old source');
    const oldThumbnail = ensureCoverThumbnailCache(coverPath, 128)!;
    const replacement = Buffer.from('new source bytes');

    const result = await registeredHandler('save-cover-thumbnail')({}, {
      id: 'track-id',
      data: replacement.toString('base64'),
      mime: 'image/jpeg',
    });

    const version = createHash('sha256').update(replacement).digest('hex').slice(0, 16);
    expect(result).toMatchObject({
      success: true,
      filePath: coverPath,
      coverUrl: `cover://track-id.jpg?v=${version}`,
    });
    expect(fs.readFileSync(coverPath)).toEqual(replacement);
    expect(fs.existsSync(oldThumbnail)).toBe(false);
    expect(fs.readdirSync(coverDirectory).some(file => file.includes('.tmp-'))).toBe(false);
  });

  it('removes stale derivatives even when the source was already deleted', async () => {
    const coverPath = path.join(coverDirectory, 'track-id.jpg');
    fs.writeFileSync(coverPath, 'source');
    const thumbnail = ensureCoverThumbnailCache(coverPath, 128)!;
    fs.unlinkSync(coverPath);

    const result = await registeredHandler('delete-cover-thumbnail')({}, 'track-id');

    expect(result).toEqual({ success: true, deleted: false });
    expect(fs.existsSync(thumbnail)).toBe(false);
  });
});
