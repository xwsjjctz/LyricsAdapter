import { useEffect, useState } from 'react';

const COMPACT_QUERY = '(max-width: 719px)';

/** Subscribe to the layout boundary, without rerendering on every resize pixel. */
export function useCompactPlayerLayout(): boolean {
  const [compact, setCompact] = useState(() => window.matchMedia?.(COMPACT_QUERY).matches ?? false);
  useEffect(() => {
    const query = window.matchMedia?.(COMPACT_QUERY);
    if (!query) return;
    const update = () => setCompact(query.matches);
    update();
    query.addEventListener?.('change', update);
    return () => query.removeEventListener?.('change', update);
  }, []);
  return compact;
}
