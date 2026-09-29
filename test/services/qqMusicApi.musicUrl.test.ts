import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ refresh: vi.fn(), getQQMusicUrl: vi.fn() }));

vi.mock('@/services/cookieManager', () => ({
  cookieManager: { hasCookie: () => true, getCookie: () => 'uin=1', parseCookie: () => ({ uin: '1' }) },
}));
vi.mock('@/services/qqCredentialManager', () => ({ qqCredentialManager: { refresh: mocks.refresh } }));
vi.mock('@/services/logger', () => ({ logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('@/services/desktopAdapter', () => ({ getDesktopAPI: () => ({ getQQMusicUrl: mocks.getQQMusicUrl }) }));

import { qqMusicApi } from '@/services/qqMusicApi';

/** A vkey response carrying one midurlinfo entry. */
const vkey = (purl: string, code: number | string = 0) => ({
  success: true,
  data: { req_1: { data: { midurlinfo: [{ purl, code }], sip: ['https://cdn.example/'] } } },
});
const requestedFile = (call: number) =>
  (mocks.getQQMusicUrl.mock.calls[call]![0] as { req_1: { param: { filename: string[] } } }).req_1.param.filename[0];

describe('QQ Music stream URLs', () => {
  beforeEach(() => {
    mocks.refresh.mockReset();
    mocks.getQQMusicUrl.mockReset();
  });

  it('names the file with the media id and reports the requested quality when served', async () => {
    mocks.getQQMusicUrl.mockResolvedValueOnce(vkey('F000abc.flac?vkey=1'));
    await expect(qqMusicApi.getMusicUrl('songA', 'flac', 'mediaB')).resolves.toEqual({
      url: 'https://cdn.example/F000abc.flac?vkey=1', bitrate: 'FLAC', quality: 'flac',
    });
    expect(requestedFile(0)).toBe('F000songAmediaB.flac');
  });

  it('falls back to songmid when no media id is known', async () => {
    mocks.getQQMusicUrl.mockResolvedValueOnce(vkey('M500x.mp3'));
    await qqMusicApi.getMusicUrl('songA', '128');
    expect(requestedFile(0)).toBe('M500songAsongA.mp3');
  });

  it('steps down FLAC → 320 → 128 instead of blaming the cookie', async () => {
    mocks.getQQMusicUrl
      .mockResolvedValueOnce(vkey('', 0))
      .mockResolvedValueOnce(vkey('', 0))
      .mockResolvedValueOnce(vkey('M500x.mp3'));
    await expect(qqMusicApi.getMusicUrl('songA', 'flac', 'mediaB')).resolves.toMatchObject({ quality: '128' });
    expect([0, 1, 2].map(requestedFile)).toEqual(['F000songAmediaB.flac', 'M800songAmediaB.mp3', 'M500songAmediaB.mp3']);
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it('steps down past a VIP-only high quality', async () => {
    mocks.getQQMusicUrl
      .mockResolvedValueOnce(vkey('', 800004))
      .mockResolvedValueOnce(vkey('M800x.mp3'));
    await expect(qqMusicApi.getMusicUrl('songA', 'flac')).resolves.toMatchObject({ quality: '320', bitrate: '320kbps' });
  });

  it('suspects the cookie only when even 128kbps comes back empty', async () => {
    mocks.refresh.mockResolvedValue(false);
    mocks.getQQMusicUrl.mockResolvedValue(vkey('', 0));
    await expect(qqMusicApi.getMusicUrl('songA', '320')).rejects.toThrow('Cookie expired or invalid');
    expect(mocks.getQQMusicUrl).toHaveBeenCalledTimes(2);
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });

  it('keeps the specific reason when the lowest quality is restricted', async () => {
    mocks.getQQMusicUrl.mockResolvedValue(vkey('', '800002'));
    await expect(qqMusicApi.getMusicUrl('songA', '128')).rejects.toThrow(/Copyright restricted/);
  });

  it('keeps the media id from search results', async () => {
    const list = [{ mid: 'songA', name: 'Song', singer: [{ name: 'S' }], file: { media_mid: 'mediaB' } }];
    (qqMusicApi as unknown as { requestJson: unknown }).requestJson =
      vi.fn().mockResolvedValue({ code: 0, req_0: { data: { body: { song: { list } } } } });
    const [song] = await qqMusicApi.searchMusic('x');
    expect(song).toMatchObject({ songmid: 'songA', mediaMid: 'mediaB' });
  });
});
