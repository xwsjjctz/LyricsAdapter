/** Formats seconds as m:ss for track lists. */
export function formatDuration(seconds: number): string {
  const safe = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
  return `${Math.floor(safe / 60)}:${(safe % 60).toString().padStart(2, '0')}`;
}
