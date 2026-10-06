import { useEffect, useState } from 'react';
import { PLAYER_COMPACT_BREAKPOINT, PLAYER_REDUCED_BREAKPOINT } from '../components/playerLayout';
import type { PlayerControlbarLayout } from '../types/playerControlbar';

const reducedQuery = `(max-width: ${PLAYER_REDUCED_BREAKPOINT - 1}px)`;
const compactQuery = `(max-width: ${PLAYER_COMPACT_BREAKPOINT - 1}px)`;

function readLayout(reduced?: MediaQueryList, compact?: MediaQueryList): PlayerControlbarLayout {
  return compact?.matches ? 'compact' : reduced?.matches ? 'reduced' : 'full';
}

/** Only content boundaries rerender React; CSS/AppKit continuously resize the seek track. */
export function usePlayerControlbarLayout(): PlayerControlbarLayout {
  const [layout, setLayout] = useState(() => readLayout(window.matchMedia?.(reducedQuery), window.matchMedia?.(compactQuery)));
  useEffect(() => {
    const reduced = window.matchMedia?.(reducedQuery);
    const compact = window.matchMedia?.(compactQuery);
    const update = () => setLayout(readLayout(reduced, compact));
    update();
    reduced?.addEventListener?.('change', update);
    compact?.addEventListener?.('change', update);
    return () => {
      reduced?.removeEventListener?.('change', update);
      compact?.removeEventListener?.('change', update);
    };
  }, []);
  return layout;
}
