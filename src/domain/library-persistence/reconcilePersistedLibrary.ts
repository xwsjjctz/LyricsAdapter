import type { SlotId } from '../../types';
import type {
  PersistedLibrarySettings as LibrarySettings,
  PersistedLibrarySnapshot as LibraryIndexData,
  PersistedLibrarySong as LibraryIndexSong,
  UserTrackRecord,
} from './models';
import {
  filterLegacyMigratableSettings,
  filterPublicSettings,
} from '../../shared/persistencePolicy';
import type { UserDataSnapshot } from '../../types/typedIpc';
import { minimalTrackToPersistedSong } from './trackRecords';

export { buildUserTracksFromLibraryCache } from './trackRecords';

const SLOT_IDS: SlotId[] = ['local', 'cloud', 'online', 'playlist'];

export type UserLibraryDecision =
  | { kind: 'user-data'; data: LibraryIndexData }
  | { kind: 'initialized-empty'; data: LibraryIndexData }
  | { kind: 'migration-pending'; data: null };

export interface SettingsHydrationPlan {
  settings: Record<string, string>;
  playbackJson?: string;
}

function isSlotId(value: unknown): value is SlotId {
  return typeof value === 'string' && SLOT_IDS.includes(value as SlotId);
}

export function hasPersistedTracks(libraryData: Partial<LibraryIndexData>): boolean {
  return Boolean(
    libraryData.songs?.length
    || libraryData.cloudSongs?.length
    || libraryData.onlineSongs?.length
    || libraryData.playlistSongs?.length
  );
}

function selectSettingsSource(
  userData: UserDataSnapshot,
  settingsFromStore?: Record<string, string>,
): Record<string, string> {
  return settingsFromStore && Object.keys(settingsFromStore).length > 0
    ? settingsFromStore
    : userData.settings || {};
}

function parsePlaybackSettings(
  userData: UserDataSnapshot,
  settingsSource?: Record<string, string>,
): LibrarySettings {
  const raw = userData.playback?.['_json']
    || settingsSource?.['playback']
    || userData.settings?.['playback'];
  if (!raw) return {};

  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function buildSettingsFromUserData(
  userData: UserDataSnapshot,
  fallbackSettings: LibrarySettings,
  settingsFromStore?: Record<string, string>,
): LibrarySettings {
  const settingsSource = selectSettingsSource(userData, settingsFromStore);
  return {
    ...fallbackSettings,
    ...parsePlaybackSettings(userData, settingsSource),
  };
}

export function getUserTrackRecords(userData: UserDataSnapshot): UserTrackRecord[] {
  return (userData.tracks || []).filter((record): record is UserTrackRecord => (
    Boolean(record && typeof record === 'object' && typeof (record as UserTrackRecord).id === 'string')
  ));
}

function inferSlotId(record: UserTrackRecord): SlotId {
  if (isSlotId(record.slotId)) return record.slotId;
  if (record.source === 'webdav') return 'cloud';
  if (record.source === 'qq' || record.source === 'netease') return 'online';
  return 'local';
}

function collectCachedSongsById(
  libraryData: Partial<LibraryIndexData>,
): Map<string, LibraryIndexSong> {
  const cachedSongs = [
    ...(libraryData.songs || []),
    ...(libraryData.cloudSongs || []),
    ...(libraryData.onlineSongs || []),
    ...(libraryData.playlistSongs || []),
  ];
  return new Map(cachedSongs.map(song => [song.id, song]));
}

function mergeUserTrackWithCachedSong(
  record: UserTrackRecord,
  cached: LibraryIndexSong | undefined,
  createTimestamp: () => string,
): LibraryIndexSong {
  const userSong = minimalTrackToPersistedSong(record, createTimestamp);
  if (!cached) return userSong;

  const merged: LibraryIndexSong = {
    ...cached,
    ...userSong,
    title: cached.title || userSong.title,
    artist: cached.artist || userSong.artist,
    album: cached.album || userSong.album,
    duration: cached.duration || userSong.duration,
  };
  const lyrics = cached.lyrics || userSong.lyrics;
  const syncedLyrics = cached.syncedLyrics || userSong.syncedLyrics;
  const coverUrl = cached.coverUrl || userSong.coverUrl;
  if (lyrics) merged.lyrics = lyrics;
  if (syncedLyrics) merged.syncedLyrics = syncedLyrics;
  if (coverUrl) merged.coverUrl = coverUrl;
  return merged;
}

function buildLibraryDataFromUserData(
  userData: UserDataSnapshot,
  fallbackSettings: LibrarySettings,
  settingsFromStore: Record<string, string> | undefined,
  cachedLibraryData: Partial<LibraryIndexData> | undefined,
  createTimestamp: () => string,
): LibraryIndexData | null {
  const records = getUserTrackRecords(userData);
  if (records.length === 0) return null;
  const cachedById = collectCachedSongsById(cachedLibraryData || {});

  const bySlot: Record<SlotId, UserTrackRecord[]> = {
    local: [],
    cloud: [],
    online: [],
    playlist: [],
  };
  for (const record of records) {
    bySlot[inferSlotId(record)].push(record);
  }

  const toLibrarySong = (record: UserTrackRecord) => (
    mergeUserTrackWithCachedSong(record, cachedById.get(record.id), createTimestamp)
  );
  const cloudSongs = bySlot.cloud.map(toLibrarySong);
  const onlineSongs = bySlot.online.map(toLibrarySong);
  const playlistSongs = bySlot.playlist.map(toLibrarySong);

  return {
    songs: bySlot.local.map(toLibrarySong),
    ...(cloudSongs.length > 0 ? { cloudSongs } : {}),
    ...(onlineSongs.length > 0 ? { onlineSongs } : {}),
    ...(playlistSongs.length > 0 ? { playlistSongs } : {}),
    settings: buildSettingsFromUserData(userData, fallbackSettings, settingsFromStore),
  };
}

export function resolveUserDataLibrary(
  userData: UserDataSnapshot,
  fallbackSettings: LibrarySettings,
  settingsFromStore: Record<string, string> | undefined,
  cachedLibraryData: Partial<LibraryIndexData> | undefined,
  createTimestamp: () => string,
): UserLibraryDecision {
  const rebuilt = buildLibraryDataFromUserData(
    userData,
    fallbackSettings,
    settingsFromStore,
    cachedLibraryData,
    createTimestamp,
  );
  if (rebuilt) return { kind: 'user-data', data: rebuilt };
  if (userData.libraryInitialized) {
    return {
      kind: 'initialized-empty',
      data: {
        songs: [],
        cloudSongs: [],
        onlineSongs: [],
        playlistSongs: [],
        settings: buildSettingsFromUserData(userData, fallbackSettings, settingsFromStore),
      },
    };
  }
  return { kind: 'migration-pending', data: null };
}

export function buildSettingsRecoverySnapshot(
  userData: UserDataSnapshot,
): Record<string, string> {
  const recovered = filterLegacyMigratableSettings(userData.settings);
  const playbackJson = userData.playback['_json'] || recovered['playback'];
  if (playbackJson) recovered['playback'] = playbackJson;
  return recovered;
}

/** Decide what should hydrate AppStorage; the caller remains responsible for I/O. */
export function buildSettingsHydrationPlan(
  userData: UserDataSnapshot,
  settingsFromStore?: Record<string, string>,
): SettingsHydrationPlan {
  const publicMainSettings = filterPublicSettings(settingsFromStore || {});
  const hasMainSettings = Object.keys(publicMainSettings).length > 0;
  const selectedSettings = filterPublicSettings(selectSettingsSource(userData, settingsFromStore));
  const settings = hasMainSettings
    ? publicMainSettings
    : filterLegacyMigratableSettings(userData.settings || selectedSettings);
  const playbackJson = userData.playback?.['_json']
    || settings['playback']
    || userData.settings?.['playback'];

  return {
    settings,
    ...(playbackJson ? { playbackJson } : {}),
  };
}
