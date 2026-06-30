import { match } from 'pinyin-pro';
import { Track } from '../types';

const trackSearchTextCache = new WeakMap<Track, { key: string; value: string }>();

function normalizeSearchText(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, '');
}

export function buildTrackSearchText(track: Track): string {
  const raw = [track.title, track.artist, track.album, track.fileName].filter(Boolean).join(' ');
  const cached = trackSearchTextCache.get(track);
  if (cached?.key === raw) return cached.value;

  const value = normalizeSearchText(raw);
  trackSearchTextCache.set(track, { key: raw, value });
  return value;
}

export function trackMatchesQuery(track: Track, query: string): boolean {
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) return false;

  const searchText = buildTrackSearchText(track);
  if (searchText.includes(normalizedQuery)) return true;

  return match(searchText, normalizedQuery, {
    insensitive: true,
    continuous: true,
    space: 'ignore',
  }) !== null;
}
