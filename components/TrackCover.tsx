import React, { useState, useRef, useEffect, memo } from 'react';
import { toCoverThumb, appendCoverQuery } from '../services/coverUrl';

interface TrackCoverProps {
  trackId: string;
  filePath?: string | undefined;
  fallbackUrl?: string | undefined;
  className?: string;
  /**
   * cover:// 封面的缩略图尺寸（像素边长），仅对 cover:// 协议生效。
   * 按容器显示尺寸的 ~2x 选择（DPR=2，含 hover scale 余量）：
   * 默认 128 覆盖 40~56px 容器；128px 容器请传 256。
   */
  thumbSize?: number;
}

const PLACEHOLDER_SVG = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="%23222"/><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" fill="%23666" font-size="14">♪</text></svg>';
const RETRY_DELAYS = [2000, 4000, 8000];

export const TrackCover: React.FC<TrackCoverProps> = memo(({
  trackId: _trackId,
  filePath: _filePath,
  fallbackUrl,
  className = 'size-10 rounded-lg object-cover',
  thumbSize = 128
}) => {
  const [hasError, setHasError] = useState(false);
  const [retryKey, setRetryKey] = useState(0);
  const retryIndexRef = useRef(0);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Reset when URL changes
  useEffect(() => {
    setHasError(false);
    setRetryKey(0);
    retryIndexRef.current = 0;
    if (retryTimerRef.current !== null) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
  }, [fallbackUrl]);

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (retryTimerRef.current !== null) {
        clearTimeout(retryTimerRef.current);
      }
    };
  }, []);

  const handleError = () => {
    // For cover:// URLs, retry a few times in case lazy migration is still in progress
    if (fallbackUrl?.startsWith('cover://') && retryIndexRef.current < RETRY_DELAYS.length) {
      const delay = RETRY_DELAYS[retryIndexRef.current]!;
      retryIndexRef.current++;
      retryTimerRef.current = setTimeout(() => {
        retryTimerRef.current = null;
        setHasError(false);
        setRetryKey(k => k + 1);
      }, delay);
    } else {
      setHasError(true);
    }
  };

  if (hasError || !fallbackUrl) {
    return <img src={PLACEHOLDER_SVG} className={className} alt="" />;
  }

  // 仅 cover:// 协议支持 ?size= 缩略图降采样；远程/blob URL 原样使用。
  // 先降采样，再用 retryKey 追加 cache-bust 参数（appendCoverQuery 会正确判断 ? / &，
  // 避免与 size 拼出非法的 `?size=128?_=1`）。
  const thumbSrc = toCoverThumb(fallbackUrl, thumbSize);
  const cacheBustSrc = retryKey > 0 ? appendCoverQuery(thumbSrc, '_', retryKey) : thumbSrc;

  return (
    <img
      key={retryKey}
      src={cacheBustSrc}
      className={className}
      alt=""
      loading="lazy"
      onError={handleError}
    />
  );
}, (prevProps, nextProps) => {
  return prevProps.trackId === nextProps.trackId &&
         prevProps.filePath === nextProps.filePath &&
         prevProps.fallbackUrl === nextProps.fallbackUrl &&
         prevProps.thumbSize === nextProps.thumbSize;
});

TrackCover.displayName = 'TrackCover';

export default TrackCover;
