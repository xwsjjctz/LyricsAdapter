import { describe, it, expect } from 'vitest';
import { detectProvider, getEffectiveConfig } from '../../../services/webdav/providerConfig';

describe('detectProvider', () => {
  it('should detect 123pan provider from 123pan.cn URL', () => {
    const provider = detectProvider('https://webdav.123pan.cn/webdav');
    expect(provider.name).toBe('123云盘');
    expect(provider.useDirectHeaderRead()).toBe(true);
    expect(provider.useMetadataFolder()).toBe(true);
    expect(provider.allowWrite()).toBe(true);
    expect(provider.autoUploadMetaJson()).toBe(false);
    expect(provider.batchSize()).toBe(4);
  });

  it('should detect 123pan provider with subdomain URL', () => {
    const provider = detectProvider('https://123pan.cn/webdav');
    expect(provider.name).toBe('123云盘');
  });

  it('should return generic provider for a generic WebDAV URL', () => {
    const provider = detectProvider('https://example.com/webdav');
    expect(provider.name).toBe('通用 WebDAV');
    expect(provider.useDirectHeaderRead()).toBe(false);
    expect(provider.useMetadataFolder()).toBe(false);
    expect(provider.allowWrite()).toBe(false);
    expect(provider.autoUploadMetaJson()).toBe(false);
    expect(provider.batchSize()).toBe(10);
  });

  it('should return generic provider for a Synology WebDAV URL', () => {
    const provider = detectProvider('https://nas.example.com:5006/webdav');
    expect(provider.name).toBe('通用 WebDAV');
  });

  it('should handle empty URL gracefully', () => {
    const provider = detectProvider('');
    expect(provider.name).toBe('通用 WebDAV');
  });

  it('should be case-insensitive for 123pan detection', () => {
    const provider = detectProvider('HTTPS://WEBDAV.123PAN.CN/WEBDAV');
    expect(provider.name).toBe('123云盘');
  });
});

describe('getEffectiveConfig', () => {
  it('should return unmodified provider when readonly is false', () => {
    const provider = getEffectiveConfig('https://webdav.123pan.cn/webdav', false);
    expect(provider.allowWrite()).toBe(true);
    expect(provider.autoUploadMetaJson()).toBe(false);
  });

  it('should disable write and meta.json upload in readonly mode', () => {
    const provider = getEffectiveConfig('https://webdav.123pan.cn/webdav', true);
    expect(provider.allowWrite()).toBe(false);
    expect(provider.autoUploadMetaJson()).toBe(false);
    // Read-only should keep useMetadataFolder for manifest reading
    expect(provider.useMetadataFolder()).toBe(true);
  });

  it('should return generic provider for unknown URL even with readonly flag', () => {
    const provider = getEffectiveConfig('https://unknown.example.com', true);
    expect(provider.name).toBe('通用 WebDAV');
    expect(provider.allowWrite()).toBe(false);
  });

  it('should handle undefined readonly as non-readonly', () => {
    const provider = getEffectiveConfig('https://webdav.123pan.cn/webdav', undefined);
    expect(provider.allowWrite()).toBe(true);
  });
});
