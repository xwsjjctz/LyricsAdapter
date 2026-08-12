import { z } from 'zod';

const libraryIndexSongSchema = z.object({
  id: z.string().min(1),
}).passthrough();

/**
 * Minimum semantic shape of the legacy rebuildable library-index cache.
 * Detailed metadata remains deliberately permissive, but null/arrays and
 * malformed slot collections must not be mistaken for a usable cache.
 */
export const libraryIndexSnapshotSchema = z.object({
  songs: z.array(libraryIndexSongSchema),
  cloudSongs: z.array(libraryIndexSongSchema).optional(),
  onlineSongs: z.array(libraryIndexSongSchema).optional(),
  playlistSongs: z.array(libraryIndexSongSchema).optional(),
  settings: z.record(z.string(), z.unknown()),
}).passthrough();
