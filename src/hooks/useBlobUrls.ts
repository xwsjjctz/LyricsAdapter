import { useCallback, useRef } from 'react';
import { logger } from '../services/logger';

export function useBlobUrls() {
  const activeBlobUrlsRef = useRef<Set<string>>(new Set());

  const createTrackedBlobUrl = useCallback((blob: Blob | File): string => {
    const blobUrl = URL.createObjectURL(blob);
    activeBlobUrlsRef.current.add(blobUrl);
    logger.debug('[BlobUrls] Created blob URL:', blobUrl, 'Total active:', activeBlobUrlsRef.current.size);
    return blobUrl;
  }, []);

  const revokeBlobUrl = useCallback((blobUrl: string) => {
    if (blobUrl && blobUrl.startsWith('blob:')) {
      try {
        URL.revokeObjectURL(blobUrl);
        activeBlobUrlsRef.current.delete(blobUrl);
        logger.debug('[BlobUrls] Revoked blob URL:', blobUrl, 'Remaining:', activeBlobUrlsRef.current.size);
      } catch (e) {
        logger.warn('[BlobUrls] Failed to revoke blob URL:', blobUrl, e);
      }
    }
  }, []);

  return {
    activeBlobUrlsRef,
    createTrackedBlobUrl,
    revokeBlobUrl
  };
}
