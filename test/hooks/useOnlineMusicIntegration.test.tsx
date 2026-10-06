import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DownloadProgressEvent } from '@/types/onlineProgress';
import type { OnlineSong, OnlineSource } from '@/services/onlineMusicProvider';

const mocks = vi.hoisted(() => ({
  download: vi.fn(), writeMetadata: vi.fn(), listen: vi.fn(), unlisten: vi.fn(), notify: vi.fn(),
}));
vi.mock('@/services/desktopAdapter', () => ({
  getDesktopAPI: () => ({ downloadAndSave: mocks.download, writeAudioMetadata: mocks.writeMetadata,
    onDownloadProgress: mocks.listen, offDownloadProgress: mocks.unlisten }),
  getDesktopAPIAsync: async () => null,
}));
vi.mock('@/services/onlineMusicProvider', () => ({
  getOnlineProvider: (id: OnlineSource = 'qq') => ({ id, getLyrics: async () => null, getCoverUrl: () => '',
    getMusicUrl: async () => ({ url: 'https://example.invalid/audio', quality: '320' }), getRawCookie: () => '' }),
}));
vi.mock('@/services/settingsManager', () => ({ settingsManager: { getDownloadPath: () => '/tmp/download-test' } }));
vi.mock('@/services/webdavClient', () => ({ webdavClient: {} }));
vi.mock('@/services/webdavMetaService', () => ({ generateMetaJson: vi.fn() }));
vi.mock('@/services/notificationService', () => ({ notify: mocks.notify }));
vi.mock('@/services/metadataService', () => ({ parseLyrics: vi.fn() }));
vi.mock('@/services/metadataCacheService', () => ({ metadataCacheService: {} }));
vi.mock('@/services/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn() } }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

import { useOnlineMusicIntegration } from '@/hooks/useOnlineMusicIntegration';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
const song: OnlineSong = { songmid: '123', songname: 'Fixture', singer: [{ name: 'Artist' }], albumname: 'Album', interval: 60 };
const completed = { success: true, filePath: '/tmp/download-test/fixture.mp3' };
const setup = () => renderHook(() => useOnlineMusicIntegration({ openSettings: vi.fn(), mergeCloudTracks: vi.fn() }));
function progress(requestId: string, percent: number) {
  const handler = mocks.listen.mock.calls[0]![0] as (event: DownloadProgressEvent) => void;
  handler({ requestId, downloaded: percent, total: 100, progress: percent });
}

beforeEach(() => { vi.clearAllMocks(); vi.useFakeTimers(); mocks.writeMetadata.mockResolvedValue({ success: true }); });
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

describe('per-song download progress', () => {
  it('routes concurrent sources independently and ignores unrelated/late events', async () => {
    const first = deferred<typeof completed>();
    const second = deferred<typeof completed>();
    mocks.download.mockImplementationOnce(() => first.promise).mockImplementationOnce(() => second.promise);
    const { result } = setup();
    let a!: Promise<void>;
    let b!: Promise<void>;
    await act(async () => {
      a = result.current.handleOnlineDownload(song, '320', 'qq');
      b = result.current.handleOnlineDownload(song, '320', 'netease');
    });
    const firstId = mocks.download.mock.calls[0]![3] as string;
    const secondId = mocks.download.mock.calls[1]![3] as string;
    expect(firstId).not.toBe(secondId);
    act(() => { progress(firstId, 31); progress(secondId, 72); progress('unrelated', 99); });
    expect(result.current.onlineProgress['online-qq-123']?.percent).toBe(31);
    expect(result.current.onlineProgress['online-netease-123']?.percent).toBe(72);
    await act(async () => { first.resolve(completed); await a; });
    act(() => progress(firstId, 80));
    expect(result.current.onlineProgress['online-qq-123']?.status).toBe('completed');
    expect(result.current.onlineProgress['online-netease-123']?.percent).toBe(72);
    await act(async () => { second.resolve(completed); await b; });
  });

  it('keeps saving distinct from completion without regressing from 100%', async () => {
    const transfer = deferred<typeof completed>();
    const metadata = deferred<{ success: boolean }>();
    mocks.download.mockReturnValue(transfer.promise);
    mocks.writeMetadata.mockReturnValue(metadata.promise);
    const { result } = setup();
    let pending!: Promise<void>;
    await act(async () => { pending = result.current.handleOnlineDownload(song, '320', 'qq'); });
    const id = mocks.download.mock.calls[0]![3] as string;
    act(() => progress(id, 100));
    await act(async () => { transfer.resolve(completed); });
    act(() => progress(id, 60));
    expect(result.current.onlineProgress['online-qq-123']).toMatchObject({ percent: 100, phase: 'saving' });
    expect(result.current.onlineProgress['online-qq-123']?.status).toBeUndefined();
    await act(async () => { metadata.resolve({ success: true }); await pending; });
    expect(result.current.onlineProgress['online-qq-123']?.status).toBe('completed');
    act(() => vi.advanceTimersByTime(3000));
    expect(result.current.onlineProgress).toEqual({});
  });

  it('does not let an old failure expiry erase a retry, and deduplicates active downloads', async () => {
    const retry = deferred<typeof completed>();
    mocks.download.mockResolvedValueOnce({ success: false, error: 'Network unavailable' })
      .mockImplementationOnce(() => retry.promise);
    const { result, unmount } = setup();
    await act(async () => { await result.current.handleOnlineDownload(song, '320', 'qq'); });
    expect(result.current.onlineProgress['online-qq-123']?.status).toBe('error');
    let pending!: Promise<void>;
    await act(async () => {
      pending = result.current.handleOnlineDownload(song, '320', 'qq');
      await result.current.handleOnlineDownload(song, '320', 'qq');
    });
    expect(mocks.download).toHaveBeenCalledTimes(2);
    act(() => vi.advanceTimersByTime(5000));
    expect(result.current.onlineProgress['online-qq-123']).toMatchObject({ phase: 'preparing', percent: 0 });
    await act(async () => { retry.resolve(completed); await pending; });
    unmount();
    expect(mocks.unlisten).toHaveBeenCalledWith(mocks.listen.mock.calls[0]![0]);
    expect(vi.getTimerCount()).toBe(0);
  });
});
