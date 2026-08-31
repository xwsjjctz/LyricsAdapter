/**
 * Normalize metadata for a single native text row. Keeping this shared avoids
 * calculating a karaoke cursor against text that the status item later changes.
 */
export function normalizeSystemLyricsText(
  value: string | null | undefined,
): string {
  return value?.replace(/\s+/gu, ' ').trim() ?? '';
}
