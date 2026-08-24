import { beforeEach, describe, expect, it, vi } from 'vitest';

const storageMocks = vi.hoisted(() => ({
  getItem: vi.fn<(key: string) => string | null>(() => null),
  setItem: vi.fn<(key: string, value: string) => Promise<void>>(),
}));

vi.mock('@/services/appStorage', () => ({
  appStorage: storageMocks,
}));

vi.mock('@/services/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { settingsManager } from '@/services/settingsManager';

function deferred(): {
  promise: Promise<void>;
  resolve: () => void;
  reject: (error: Error) => void;
} {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe('SettingsManager persistence contract', () => {
  beforeEach(() => {
    storageMocks.getItem.mockReset();
    storageMocks.getItem.mockReturnValue(null);
    storageMocks.setItem.mockReset();
    storageMocks.setItem.mockResolvedValue(undefined);
    (settingsManager as unknown as { onlineSource: string }).onlineSource = 'qq';
    (settingsManager as unknown as { downloadPath: string }).downloadPath = '';
    (settingsManager as unknown as { persistenceRevisions: Map<string, number> }).persistenceRevisions.clear();
  });

  it('reports a durable write failure and rolls back the current value', async () => {
    storageMocks.setItem.mockRejectedValueOnce(new Error('disk full'));

    await expect(settingsManager.setOnlineSource('netease')).resolves.toBe(false);
    expect(settingsManager.getOnlineSource()).toBe('qq');
  });

  it('falls back to QQ Music when a removed provider was stored', () => {
    storageMocks.getItem.mockImplementation(key => key === 'la_online_source' ? 'soda' : null);

    (settingsManager as unknown as { loadFromStorage: () => void }).loadFromStorage();

    expect(settingsManager.getOnlineSource()).toBe('qq');
  });

  it('does not let an older failed write roll back a newer successful value', async () => {
    const older = deferred();
    const newer = deferred();
    storageMocks.setItem
      .mockImplementationOnce(() => older.promise)
      .mockImplementationOnce(() => newer.promise);

    const olderResult = settingsManager.setOnlineSource('netease');
    const newerResult = settingsManager.setOnlineSource('qq');
    newer.resolve();
    await expect(newerResult).resolves.toBe(true);
    older.reject(new Error('older write failed'));

    await expect(olderResult).resolves.toBe(false);
    expect(settingsManager.getOnlineSource()).toBe('qq');
  });

  it('lets save flows await download-path durability', async () => {
    const write = deferred();
    storageMocks.setItem.mockImplementationOnce(() => write.promise);

    const result = settingsManager.setDownloadPath('/music');
    expect(settingsManager.getDownloadPath()).toBe('/music');
    write.resolve();

    await expect(result).resolves.toBe(true);
  });
});
