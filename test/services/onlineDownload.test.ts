import { describe, expect, it, vi } from 'vitest';
import { QUALITY_LABEL, saveOnlineAudio } from '@/services/onlineDownload';
import { servedNetEaseQuality } from '@/services/neteaseMusicApi';
import type { OnlineMusicProvider, OnlineQuality } from '@/services/onlineMusicProvider';

const song = { songmid: 'songA', songname: 'Title', singer: [{ name: 'Artist' }], mediaMid: 'mediaB' };

function provider(served: OnlineQuality) {
  return {
    getMusicUrl: vi.fn().mockResolvedValue({ url: 'https://cdn.example/file', bitrate: 'x', quality: served }),
    getRawCookie: () => 'cookie=1',
  } as unknown as OnlineMusicProvider & { getMusicUrl: ReturnType<typeof vi.fn> };
}

describe('saving online audio', () => {
  it('names the file after the quality actually served', async () => {
    const p = provider('320');
    const save = vi.fn().mockResolvedValue({ success: true, filePath: '/music/Artist - Title.mp3' });
    const saved = await saveOnlineAudio({ provider: p, song, quality: 'flac', singer: 'Artist', downloadPath: '/music', save });
    expect(p.getMusicUrl).toHaveBeenCalledWith('songA', 'flac', 'mediaB');
    expect(save.mock.calls[0]![2]).toMatch(/\.mp3$/);
    expect(saved).toMatchObject({ served: '320', fileName: expect.stringMatching(/\.mp3$/) });
  });

  it('keeps FLAC when FLAC was served', async () => {
    const save = vi.fn().mockResolvedValue({ success: true, filePath: '/music/a.flac' });
    const saved = await saveOnlineAudio({ provider: provider('flac'), song, quality: 'flac', singer: 'Artist', downloadPath: '/music', save });
    expect(saved.fileName).toMatch(/\.flac$/);
  });

  it('surfaces the main-process error instead of a generic one', async () => {
    const save = vi.fn().mockResolvedValue({ success: false, error: 'HTTP error: 403' });
    await expect(saveOnlineAudio({ provider: provider('128'), song, quality: '128', singer: 'A', downloadPath: '/m', save }))
      .rejects.toThrow('HTTP error: 403');
    await expect(saveOnlineAudio({ provider: provider('128'), song, quality: '128', singer: 'A', downloadPath: '/m', save: undefined }))
      .rejects.toThrow(/desktop app/);
  });

  it('labels qualities for the downgrade message', () => {
    expect(QUALITY_LABEL.flac).toBe('FLAC');
    expect(QUALITY_LABEL['320']).toBe('320kbps');
  });
});

describe('NetEase served quality', () => {
  it('reads the served container and bitrate rather than trusting the request', () => {
    expect(servedNetEaseQuality({ type: 'flac', br: 999000 }, 'flac')).toBe('flac');
    expect(servedNetEaseQuality({ type: 'mp3', br: 320000 }, 'flac')).toBe('320');
    expect(servedNetEaseQuality({ type: 'MP3', br: 128000 }, 'flac')).toBe('128');
    expect(servedNetEaseQuality({ type: 'm4a', br: 192000 }, '320')).toBe('m4a');
    expect(servedNetEaseQuality({ type: null, br: 0 }, '320')).toBe('320');
  });
});
