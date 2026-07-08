export function hasPendingCoverReplacement(pendingCoverDataUrl: string | null | undefined): pendingCoverDataUrl is string {
  return typeof pendingCoverDataUrl === 'string' && pendingCoverDataUrl.length > 0;
}

export function getCoverUrlForMetadataWrite(
  pendingCoverDataUrl: string | null | undefined,
  currentCoverUrl: string | undefined,
): string | undefined {
  return hasPendingCoverReplacement(pendingCoverDataUrl)
    ? pendingCoverDataUrl
    : currentCoverUrl;
}

export function getSavedTrackCoverUrl(
  currentCoverUrl: string | undefined,
  cachedReplacementCoverUrl: string | null | undefined,
): string | undefined {
  return cachedReplacementCoverUrl || currentCoverUrl;
}
