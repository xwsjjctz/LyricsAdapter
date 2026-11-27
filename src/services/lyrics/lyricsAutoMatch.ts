import type { Track } from '../../types';
import type { OnlineLyricsResult, OnlineMusicProvider } from '../online/onlineMusicProvider';
import { availableMusicSources, getMusicPluginInfo, musicPluginState } from '../online/musicPlugins';
import { cookieStoreFor, providerFor } from '../online/musicSources';
import { getDesktopAPI } from '../desktopAdapter';
import { logger } from '../logger';
import {
  isInstrumentalTitle,
  lyricsSearchTerms,
  rankLyricsCandidates,
  type LyricsMatchQuery,
} from '../../domain/lyricsMatch';

/**
 * Finds lyrics for a local track that has none: first from the installed music
 * sources (signed-in ones before anonymous ones), then from the community
 * collection. Only a song that is certainly the same recording is used.
 */

const SEARCH_LIMIT = 10;
/** The best match may have no lyrics on the platform; the runner-up is often the same song filed twice. */
const CANDIDATES_TRIED = 2;
/** Platforms answer an instrumental with a one-line notice instead of lyrics. */
const NO_LYRICS_NOTICE = /纯音乐|純音樂|没有填词|沒有填詞|暂无歌词|暫無歌詞/;
const UNKNOWN_ALBUMS = new Set(['', 'Unknown Album']);

export interface LyricsSources {
  /** Music sources that can be searched now, in the order to ask them. */
  providers: readonly Pick<OnlineMusicProvider, 'id' | 'searchMusic' | 'getLyrics'>[];
  /** The community collection; absent where it cannot be reached (browser mode). */
  community?: ((query: LyricsMatchQuery) => Promise<OnlineLyricsResult | null>) | undefined;
}

export interface LyricsSearchOutcome {
  lyrics: OnlineLyricsResult | null;
  /**
   * Whether the track needs no further lookup: lyrics were found, or a music
   * platform was searched and every source answered. A failed source, or having
   * only the small community collection to ask, leaves the question open.
   */
  conclusive: boolean;
}

/** A local file that shows no lyrics and may have some found for it. */
export function needsLyricsMatch(track: Track): boolean {
  return Boolean(track.filePath)
    && (track.source === undefined || track.source === 'local')
    && !track.lyrics?.trim()
    && !track.syncedLyrics?.length
    && Boolean(track.title.trim())
    && !isInstrumentalTitle(track.title);
}

export function lyricsQueryFor(track: Track): LyricsMatchQuery {
  return {
    title: track.title,
    artist: track.artist,
    ...(UNKNOWN_ALBUMS.has(track.album) ? {} : { album: track.album }),
    ...(track.duration > 0 ? { duration: track.duration } : {}),
  };
}

function hasLyricText(result: OnlineLyricsResult | null): result is OnlineLyricsResult {
  if (!result) return false;
  if (result.wordLyrics?.trim()) return true;
  const text = result.lyrics?.trim() ?? '';
  if (!text) return false;
  return !(text.split('\n').length <= 3 && NO_LYRICS_NOTICE.test(text));
}

async function fromProvider(
  provider: LyricsSources['providers'][number],
  query: LyricsMatchQuery,
): Promise<OnlineLyricsResult | null> {
  const terms = lyricsSearchTerms(query);
  const songs = await provider.searchMusic([terms.title, terms.artist].filter(Boolean).join(' '), SEARCH_LIMIT);
  const ranked = rankLyricsCandidates(query, songs, song => ({
    title: song.songname,
    artists: song.singer.map(singer => singer.name),
    album: song.albumname,
    duration: song.interval,
  }));
  for (const song of ranked.slice(0, CANDIDATES_TRIED)) {
    const lyrics = await provider.getLyrics(song.songmid);
    if (hasLyricText(lyrics)) {
      logger.debug(`[LyricsMatch] ${provider.id} matched "${song.songname}" for "${query.title}"`);
      return lyrics;
    }
  }
  return null;
}

/** Asks each source in turn and stops at the first that has lyrics. */
export async function findLyrics(query: LyricsMatchQuery, sources: LyricsSources): Promise<LyricsSearchOutcome> {
  let failed = false;
  let platformsSearched = 0;
  for (const provider of sources.providers) {
    try {
      const lyrics = await fromProvider(provider, query);
      if (lyrics) return { lyrics, conclusive: true };
      platformsSearched++;
    } catch (error) {
      failed = true;
      logger.warn(`[LyricsMatch] ${provider.id} could not be searched:`, error);
    }
  }
  if (sources.community) {
    try {
      const lyrics = await sources.community(query);
      if (hasLyricText(lyrics)) return { lyrics, conclusive: true };
    } catch (error) {
      failed = true;
      logger.warn('[LyricsMatch] The community collection could not be searched:', error);
    }
  }
  return { lyrics: null, conclusive: !failed && platformsSearched > 0 };
}

/** The sources available right now: lyric-capable music plugins, signed-in ones first, then the community collection. */
export async function currentLyricsSources(): Promise<LyricsSources> {
  const ids = availableMusicSources(musicPluginState.getSnapshot().plugins)
    .filter(id => getMusicPluginInfo(id)?.capabilities.includes('lyrics'));
  await Promise.all(ids.map(id => cookieStoreFor(id).ensureLoaded().catch(error => {
    logger.warn(`[LyricsMatch] Could not load the ${id} sign-in:`, error);
  })));
  const usable = ids.map(providerFor).filter(provider => provider.hasCookie() || !provider.requiresCookie());
  const desktop = getDesktopAPI();
  return {
    providers: [...usable.filter(provider => provider.hasCookie()), ...usable.filter(provider => !provider.hasCookie())],
    community: desktop ? query => desktop.matchCommunityLyrics(query) : undefined,
  };
}
