/**
 * Color manipulation utilities.
 *
 * Used to derive alpha-tinted CSS variables from solid theme colors so that
 * tinted backgrounds can be expressed as `var(--theme-primary-13)` etc. and
 * re-resolved automatically by the browser on theme switch — instead of being
 * baked into inline styles as concrete RGB strings that don't refresh.
 */

/**
 * Parse a `#rgb` or `#rrggbb` hex color into its `"r, g, b"` channel string.
 * Returns `null` when the input cannot be parsed.
 */
export function hexToRgb(hex: string): string | null {
  const sanitized = hex.trim().replace(/^#/, '');
  const match =
    sanitized.length === 3
      ? /^([a-f\d])([a-f\d])([a-f\d])$/i.exec(sanitized)
      : /^([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(sanitized);

  if (!match) return null;

  const [, r, g, b] = match;
  const expand = (channel: string): number =>
    parseInt(channel.length === 1 ? channel + channel : channel, 16);

  return `${expand(r!)}, ${expand(g!)}, ${expand(b!)}`;
}

/**
 * Convert a hex color to an `rgba(r, g, b, alpha)` string.
 * Falls back to a neutral gray when the input is not a parseable hex color,
 * so callers (e.g. theme variable registration) never emit invalid CSS.
 */
export function hexToRgba(hex: string, alpha: number): string {
  const rgb = hexToRgb(hex);
  return rgb ? `rgba(${rgb}, ${alpha})` : `rgba(128, 128, 128, ${alpha})`;
}
