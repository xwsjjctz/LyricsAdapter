import { z } from 'zod';
import {
  stringRecordSchema,
  userDataSnapshotSchema,
  userTrackRecordSchema,
} from '../../src/shared/userDataSchema';
import { libraryIndexSnapshotSchema } from '../../src/shared/libraryIndexSchema';

export { userDataSnapshotSchema } from '../../src/shared/userDataSchema';

function storeReadSchema<T extends z.ZodTypeAny>(dataSchema: T) {
  return z.discriminatedUnion('status', [
    z.object({ status: z.literal('ready'), data: dataSchema }),
    z.object({ status: z.literal('error'), error: z.string() }),
  ]);
}

/** Response schema for the read-only persistence bootstrap facade. */
export const persistenceBootstrapSchema = z.object({
  settings: storeReadSchema(stringRecordSchema),
  userData: storeReadSchema(userDataSnapshotSchema),
  libraryIndex: storeReadSchema(libraryIndexSnapshotSchema),
});

/** Final close snapshot. All physical writes are validated before the use-case runs. */
export const persistenceCloseCommitSchema = z.object({
  libraryIndex: libraryIndexSnapshotSchema,
  userData: z.discriminatedUnion('mode', [
    z.object({
      mode: z.literal('write'),
      tracks: z.array(userTrackRecordSchema),
    }),
    z.object({ mode: z.literal('skip') }),
  ]),
});

const httpUrlSchema = z.string().url().refine(value => {
  const protocol = new URL(value).protocol;
  return protocol === 'http:' || protocol === 'https:';
}, 'Only http and https URLs are allowed');

const systemLyricsCoverUrlSchema = z.string().max(8192).refine(value => {
  if (value === '') return true;
  try {
    const protocol = new URL(value).protocol;
    return protocol === 'cover:' || protocol === 'https:';
  } catch {
    return false;
  }
}, 'Only cover and https artwork URLs are allowed');

const webdavCredentialsSchema = z.enum(['stored', 'none']);

// Title, artist and album tags; real ones are far shorter.
const MAX_TRACK_TEXT = 1024;
// Folders from one drop; each is still walked under the scan limits.
const MAX_DROPPED_PATHS = 1000;
// Windows extended-length paths top out here; everything else is shorter.
const MAX_PATH_LENGTH = 32_767;

export const typedIpcSchemas = {
  filePath: z.object({
    filePath: z.string().min(1),
  }),
  audioPaths: z.object({
    paths: z.array(z.string().min(1).max(MAX_PATH_LENGTH)).min(1).max(MAX_DROPPED_PATHS),
  }),
  lyricsMatchQuery: z.object({
    title: z.string().min(1).max(MAX_TRACK_TEXT),
    artist: z.string().max(MAX_TRACK_TEXT),
    album: z.string().max(MAX_TRACK_TEXT).optional(),
    duration: z.number().finite().nonnegative().optional(),
  }),
  library: z.unknown(),
  webdavPropfind: z.object({
    url: httpUrlSchema,
    credentials: webdavCredentialsSchema,
    depth: z.enum(['0', '1']),
  }),
  webdavRange: z.object({
    url: httpUrlSchema,
    credentials: webdavCredentialsSchema,
    start: z.number().int(),
    end: z.number().int(),
  }),
  webdavPut: z.object({
    url: httpUrlSchema,
    credentials: webdavCredentialsSchema,
    data: z.instanceof(ArrayBuffer),
    contentType: z.string().min(1),
  }),
  webdavDelete: z.object({
    url: httpUrlSchema,
    credentials: webdavCredentialsSchema,
  }),
  webdavGetRedirect: z.object({
    url: httpUrlSchema,
    credentials: webdavCredentialsSchema,
  }),
  webdavMkcol: z.object({
    url: httpUrlSchema,
    credentials: webdavCredentialsSchema,
  }),
  webdavTest: z.object({
    serverUrl: httpUrlSchema,
    username: z.string().min(1),
    password: z.string(),
  }),
  systemLyricsState: z.object({
    trackId: z.string().max(4096).nullable(),
    coverUrl: systemLyricsCoverUrlSchema,
    title: z.string().max(512),
    artist: z.string().max(512),
    line: z.string().max(4096),
    lineCursor: z.number().int().min(0).max(4095).nullable(),
    lineProgress: z.number().int().min(0).max(4096).nullable(),
    nextLine: z.string().max(4096),
    isPlaying: z.boolean(),
  }),
  settingsGet: z.object({
    key: z.string().min(1),
  }),
  settingsSet: z.object({
    key: z.string().min(1),
    value: z.string(),
  }),
  settingsEntries: z.object({
    entries: stringRecordSchema,
  }),
  userDataLibraryState: z.object({
    tracks: z.array(userTrackRecordSchema),
    playback: stringRecordSchema,
  }),
};

export type TypedIpcSchemas = typeof typedIpcSchemas;
