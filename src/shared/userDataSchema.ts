import { z } from 'zod';
import { USER_DATA_SCHEMA_VERSION } from './persistencePolicy';

export const stringRecordSchema = z.record(z.string(), z.string());

export const userTrackRecordSchema = z.object({
  id: z.string().min(1),
  slotId: z.enum(['local', 'cloud', 'online', 'playlist']).optional(),
  filePath: z.string().optional(),
  webdavPath: z.string().optional(),
  fileName: z.string().optional(),
  fileSize: z.number().optional(),
  lastModified: z.number().optional(),
  source: z.string().optional(),
  addedAt: z.string().optional(),
  playCount: z.number().optional(),
  lastPlayed: z.string().nullable().optional(),
  songmid: z.string().optional(),
  available: z.boolean().optional(),
}).passthrough();

export const userDataSnapshotSchema = z.object({
  schemaVersion: z.literal(USER_DATA_SCHEMA_VERSION),
  libraryInitialized: z.boolean(),
  tracks: z.array(userTrackRecordSchema),
  settings: stringRecordSchema,
  playback: stringRecordSchema,
}).passthrough();

/**
 * The pre-v1 shape had no way to distinguish an intentional empty library
 * from an interrupted migration. Preserve a non-empty legacy library as
 * initialized; keep an empty one migration-pending so an existing index is not
 * destructively cleared during upgrade.
 */
const legacyUserDataSnapshotSchema = z.object({
  schemaVersion: z.undefined().optional(),
  libraryInitialized: z.undefined().optional(),
  tracks: z.array(userTrackRecordSchema),
  settings: stringRecordSchema,
  playback: stringRecordSchema,
}).passthrough();

export type ValidatedUserDataSnapshot = z.infer<typeof userDataSnapshotSchema>;

export function normalizeStoredUserDataSnapshot(value: unknown): ValidatedUserDataSnapshot | null {
  const current = userDataSnapshotSchema.safeParse(value);
  if (current.success) return current.data;

  const legacy = legacyUserDataSnapshotSchema.safeParse(value);
  if (!legacy.success) return null;
  return {
    ...legacy.data,
    schemaVersion: USER_DATA_SCHEMA_VERSION,
    libraryInitialized: legacy.data.tracks.length > 0,
  };
}

export function isStoredUserDataSnapshot(value: unknown): boolean {
  return normalizeStoredUserDataSnapshot(value) !== null;
}
