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

export const typedIpcSchemas = {
  filePath: z.object({
    filePath: z.string().min(1),
  }),
  library: z.unknown(),
  webdavPropfind: z.object({
    url: httpUrlSchema,
    authHeader: z.string(),
    depth: z.enum(['0', '1']),
  }),
  webdavRange: z.object({
    url: httpUrlSchema,
    authHeader: z.string(),
    start: z.number().int(),
    end: z.number().int(),
  }),
  webdavPut: z.object({
    url: httpUrlSchema,
    authHeader: z.string(),
    data: z.instanceof(ArrayBuffer),
    contentType: z.string().min(1),
  }),
  webdavDelete: z.object({
    url: httpUrlSchema,
    authHeader: z.string(),
  }),
  webdavGetRedirect: z.object({
    url: httpUrlSchema,
    authHeader: z.string(),
  }),
  webdavMkcol: z.object({
    url: httpUrlSchema,
    authHeader: z.string(),
  }),
  downloadAudio: z.object({
    url: httpUrlSchema,
    cookieString: z.string(),
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
  userDataSave: z.object({
    data: userDataSnapshotSchema,
  }),
  userDataTracks: z.object({
    tracks: z.array(userTrackRecordSchema),
  }),
  userDataLibraryState: z.object({
    tracks: z.array(userTrackRecordSchema),
    playback: stringRecordSchema,
  }),
};

export type TypedIpcSchemas = typeof typedIpcSchemas;
