import { useEffect, useState } from 'react';

const PORTRAIT_QUERY = '(orientation: portrait)';

/** Subscribe only to orientation changes, rather than every resized pixel. */
export function useFocusPortraitLayout(): boolean {
  const [portrait, setPortrait] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia(PORTRAIT_QUERY).matches);

  useEffect(() => {
    const query = window.matchMedia(PORTRAIT_QUERY);
    const update = () => setPortrait(query.matches);
    query.addEventListener('change', update);
    update();
    return () => query.removeEventListener('change', update);
  }, []);

  return portrait;
}
