import { describe, expect, it } from 'vitest';
import { buildTrackMenuItems, downloadQualityOf, type TrackMenuItem } from '@/components/trackMenuItems';

const actionIds = (items: TrackMenuItem[]) =>
  items.flatMap(item => (item.kind === 'action' ? [item.id] : []));

describe('buildTrackMenuItems', () => {
  it('offers edit, multi-select and remove for local tracks', () => {
    const items = buildTrackMenuItems({ dataSource: 'local', canEdit: true, canDownload: false });
    expect(actionIds(items)).toEqual(['edit', 'select', 'remove']);
    expect(items.find(item => item.kind === 'action' && item.id === 'remove')).toMatchObject({ danger: true });
  });

  it('omits edit when metadata editing is unavailable', () => {
    const items = buildTrackMenuItems({ dataSource: 'local', canEdit: false, canDownload: false });
    expect(actionIds(items)).toEqual(['select', 'remove']);
  });

  it('adds a download quality group before management actions for online queue tracks', () => {
    const items = buildTrackMenuItems({ dataSource: 'online', canEdit: true, canDownload: true });
    expect(items[0]).toEqual({ kind: 'label', labelKey: 'browse.download' });
    expect(actionIds(items)).toEqual([
      'download:128', 'download:320', 'download:flac', 'edit', 'select', 'remove',
    ]);
  });

  it('gives platform playlist tracks download actions only', () => {
    const items = buildTrackMenuItems({ dataSource: 'playlist', canEdit: true, canDownload: true });
    expect(actionIds(items)).toEqual(['download:128', 'download:320', 'download:flac']);
  });

  it('returns no items when a playlist track cannot be downloaded', () => {
    expect(buildTrackMenuItems({ dataSource: 'playlist', canEdit: true, canDownload: false })).toEqual([]);
  });

  it('gives online search results download actions only', () => {
    const items = buildTrackMenuItems({ dataSource: 'search', canEdit: true, canDownload: true });
    expect(actionIds(items)).toEqual(['download:128', 'download:320', 'download:flac']);
  });

  it('gives local search results no menu', () => {
    expect(buildTrackMenuItems({ dataSource: 'search', canEdit: true, canDownload: false })).toEqual([]);
  });

  it('keeps cloud tracks without a menu', () => {
    expect(buildTrackMenuItems({ dataSource: 'cloud', canEdit: true, canDownload: true })).toEqual([]);
  });

  it('never starts, ends, or doubles up with a separator', () => {
    for (const dataSource of ['local', 'online', 'playlist'] as const) {
      for (const canDownload of [true, false]) {
        const items = buildTrackMenuItems({ dataSource, canEdit: true, canDownload });
        if (items.length === 0) continue;
        expect(items[0]?.kind).not.toBe('separator');
        expect(items[items.length - 1]?.kind).not.toBe('separator');
        items.forEach((item, index) => {
          if (item.kind === 'separator') expect(items[index + 1]?.kind).not.toBe('separator');
        });
      }
    }
  });
});

describe('downloadQualityOf', () => {
  it('extracts the quality from download actions only', () => {
    expect(downloadQualityOf('download:flac')).toBe('flac');
    expect(downloadQualityOf('remove')).toBeNull();
  });
});
