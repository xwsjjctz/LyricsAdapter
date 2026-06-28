import { describe, expect, it } from 'vitest';
import {
  getCoverUrlForMetadataWrite,
  getSavedTrackCoverUrl,
  hasPendingCoverReplacement,
} from '@/services/metadataCoverCachePolicy';

describe('metadata cover cache policy', () => {
  it('does not treat text-only metadata edits as cover replacements', () => {
    expect(hasPendingCoverReplacement(null)).toBe(false);
    expect(hasPendingCoverReplacement(undefined)).toBe(false);
    expect(hasPendingCoverReplacement('')).toBe(false);
  });

  it('treats a pending data URL as a cover replacement', () => {
    expect(hasPendingCoverReplacement('data:image/png;base64,abc')).toBe(true);
  });

  it('writes the pending cover when one was selected', () => {
    const pendingCover = 'data:image/png;base64,abc';

    expect(getCoverUrlForMetadataWrite(pendingCover, 'cover://track.jpg')).toBe(pendingCover);
  });

  it('keeps the current cover URL for text-only saves', () => {
    expect(getCoverUrlForMetadataWrite(null, 'cover://track.jpg')).toBe('cover://track.jpg');
  });

  it('uses the refreshed cache URL after replacing a cover', () => {
    expect(getSavedTrackCoverUrl('cover://old.jpg', 'cover://new.png')).toBe('cover://new.png');
  });

  it('preserves the current cache URL when no replacement cache was produced', () => {
    expect(getSavedTrackCoverUrl('cover://old.jpg', null)).toBe('cover://old.jpg');
  });
});
