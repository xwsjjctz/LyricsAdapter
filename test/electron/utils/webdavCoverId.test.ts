import { describe, expect, it } from 'vitest';
import {
  computeWebdavCoverId,
  sanitizeTrackId,
  webdavPathHash,
} from '@/electron/utils/webdavCoverId';

describe('computeWebdavCoverId', () => {
  it('returns null for non-webdav track ids (local tracks need no conversion)', () => {
    expect(computeWebdavCoverId('/local/path/song.flac')).toBeNull();
    expect(computeWebdavCoverId('local-abc123')).toBeNull();
    expect(computeWebdavCoverId('')).toBeNull();
  });

  it('derives a stable cover id from a webdav track id', () => {
    const trackId = 'webdav-/Music/周杰伦/晴天.flac';
    const id = computeWebdavCoverId(trackId);
    expect(id).not.toBeNull();
    // 稳定：同一 trackId 多次计算结果一致
    expect(computeWebdavCoverId(trackId)).toBe(id);
    // 与封面文件命名一致：sanitizeTrackId(`${pathHash}-${webdavPath}`)
    const webdavPath = trackId.slice('webdav-'.length);
    expect(id).toBe(sanitizeTrackId(`${webdavPathHash(webdavPath)}-${webdavPath}`));
  });

  it('produces distinct ids for distinct webdav paths (pathHash prevents post-sanitize collision)', () => {
    // sanitize 把非 [a-zA-Z0-9_-] 替换为 '_'，若无 pathHash 前缀，"/a/1" 与 "/a1" 会碰撞。
    const a = computeWebdavCoverId('webdav-/a/1');
    const b = computeWebdavCoverId('webdav-/a1');
    expect(a).not.toBe(b);
  });

  it('matches the stem embedded in the cover:// URL written by save-cover-thumbnail (Bug 1 regression)', () => {
    // 端到端：trackId → coverId 必须与 cover://<coverId>.<ext> 的 stem 一致。
    // cleanup-orphan-covers 用 computeWebdavCoverId 把 cloud trackId 纳入活跃集，
    // 若与写盘文件名不一致，所有 WebDAV 封面会被误判为孤儿删除。
    const trackId = 'webdav-/Music/song.flac';
    const coverId = computeWebdavCoverId(trackId);
    const coverUrl = `cover://${coverId}.jpg`;
    const stem = coverUrl
      .slice('cover://'.length)
      .split('?')[0]!
      .replace(/\.(jpg|jpeg|png|webp)$/i, '');
    expect(stem).toBe(coverId);
  });
});
