import { match } from 'pinyin-pro';
import type { Track } from '../types';

export interface TrackSearchResult {
  items: Track[];
  /** All matches, including those cut off by the limit. */
  total: number;
}

function normalizeSearchText(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9一-鿿]+/g, '');
}

/** Matches title/artist/album/file name, accent-insensitive, with pinyin support. */
export function trackMatchesSearch(track: Track, query: string): boolean {
  const trimmedQuery = query.trim();
  if (!trimmedQuery) return false;

  const searchText = [track.title, track.artist, track.album, track.fileName].filter(Boolean).join(' ');
  if (normalizeSearchText(searchText).includes(normalizeSearchText(trimmedQuery))) return true;

  return match(searchText, trimmedQuery, {
    insensitive: true,
    continuous: true,
    space: 'ignore',
  }) !== null;
}

export function searchTracks(tracks: Track[], query: string, limit = Infinity): TrackSearchResult {
  const matches = tracks.filter(track => trackMatchesSearch(track, query));
  return { items: matches.slice(0, limit), total: matches.length };
}
