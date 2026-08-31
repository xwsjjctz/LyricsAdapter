const graphemeSegmenter = typeof Intl.Segmenter === 'function'
  ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
  : null;

/** Split user-visible characters without tearing apart emoji or combining marks. */
export function splitGraphemes(value: string): string[] {
  if (!graphemeSegmenter) return Array.from(value);
  return Array.from(graphemeSegmenter.segment(value), segment => segment.segment);
}

/** Count user-visible characters using the same segmentation as native lyrics. */
export function countGraphemes(value: string): number {
  if (!graphemeSegmenter) return Array.from(value).length;

  let count = 0;
  for (const _segment of graphemeSegmenter.segment(value)) count += 1;
  return count;
}
