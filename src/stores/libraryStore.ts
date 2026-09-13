import { useCallback, useEffect, useRef, useState } from 'react';
import { useGsapSlotTransition } from '../hooks/useGsapSlotTransition';
import { useLibrarySlots } from '../hooks/useLibrarySlots';
import { webdavClient } from '../services/webdavClient';
import type { SlotId } from '../types';

// Aligned with SlotId so the play context (which may be the 'playlist' slot) can
// flow through the same APIs. The library VIEW only ever sets viewSlot to
// local/cloud/online at runtime; 'playlist' is a play-only context.
export type LibrarySlotId = SlotId;

// Scroll events fire far faster than the UI needs to persist a position. Keep
// the live value in a ref and commit it to slot state only after the scroll
// settles; slot switches and the close flush read the ref so nothing is lost.
const SCROLL_COMMIT_DELAY_MS = 250;

export function useLibraryStore() {
  const library = useLibrarySlots();
  const [viewSlot, setViewSlot] = useState<LibrarySlotId>('local');
  const { containerRef: libraryContentRef, switchSlot: transitionToSlot, completeEnter: completeSlotEnter } = useGsapSlotTransition(viewSlot, setViewSlot);
  const [pendingSlotLocate, setPendingSlotLocate] = useState<{ token: number; slot: LibrarySlotId } | null>(null);
  const [cloudWritable, setCloudWritable] = useState<boolean | null>(null);
  const slotLocateTokenRef = useRef(0);
  // The slot whose live scroll the ref currently represents. Scroll events and
  // the unmount callback of a LibraryView that is being replaced by a slot
  // switch must not overwrite the newly selected slot's position.
  const liveScrollRef = useRef<{ slot: LibrarySlotId; position: number }>({ slot: 'local', position: 0 });
  const scrollCommitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const slotsRef = useRef(library.slots);
  slotsRef.current = library.slots;

  const cancelPendingScrollCommit = useCallback(() => {
    if (scrollCommitTimerRef.current !== null) {
      clearTimeout(scrollCommitTimerRef.current);
      scrollCommitTimerRef.current = null;
    }
  }, []);

  useEffect(() => cancelPendingScrollCommit, [cancelPendingScrollCommit]);

  useEffect(() => {
    if (viewSlot !== 'cloud') return;
    if (!webdavClient.hasConfig()) {
      setCloudWritable(false);
      return;
    }

    let cancelled = false;
    webdavClient.checkWritable().then(result => {
      if (!cancelled) setCloudWritable(result.writable);
    });
    return () => {
      cancelled = true;
    };
  }, [viewSlot]);

  const handleSwitchSlot = useCallback(async (targetSlot: LibrarySlotId, options?: { locateCurrentTrack?: boolean }) => {
    if (targetSlot === viewSlot) return;
    // Flush the live position of the slot being left before the view changes.
    // Capture it now: React may apply the updater after the ref is reassigned.
    cancelPendingScrollCommit();
    const outgoingPosition = liveScrollRef.current.position;
    library.updateSlot(viewSlot, slot => ({ ...slot, scrollPosition: outgoingPosition }));
    // From here on the ref belongs to the incoming slot, so a late scroll or
    // unmount callback from the outgoing LibraryView cannot overwrite it.
    liveScrollRef.current = {
      slot: targetSlot,
      position: slotsRef.current[targetSlot].scrollPosition,
    };
    if (options?.locateCurrentTrack) {
      setPendingSlotLocate({ token: ++slotLocateTokenRef.current, slot: targetSlot });
    }
    await transitionToSlot(targetSlot);
  }, [viewSlot, library.updateSlot, transitionToSlot, cancelPendingScrollCommit]);

  const handleSlotContentReady = useCallback((slot: LibrarySlotId) => {
    completeSlotEnter(slot);
  }, [completeSlotEnter]);

  const handleSlotLocatePrepared = useCallback((token: number) => {
    setPendingSlotLocate(current => current?.token === token ? null : current);
  }, []);

  const commitScrollPosition = useCallback(() => {
    cancelPendingScrollCommit();
    const { slot, position } = liveScrollRef.current;
    library.updateSlot(slot, current => (
      current.scrollPosition === position ? current : { ...current, scrollPosition: position }
    ));
  }, [cancelPendingScrollCommit, library.updateSlot]);

  const handleLibraryScrollPositionChange = useCallback((position: number) => {
    // A LibraryView that is being unmounted by a slot switch still calls this
    // once with its final offset; ignore it unless it is still the live slot.
    if (liveScrollRef.current.slot !== viewSlot) return;
    liveScrollRef.current = { slot: viewSlot, position };
    // Committing on every scroll event re-renders App -> AppShell ->
    // LibraryView/Sidebar dozens of times per second. Defer the state commit
    // until scrolling pauses; the ref stays authoritative in the meantime.
    cancelPendingScrollCommit();
    scrollCommitTimerRef.current = setTimeout(() => {
      scrollCommitTimerRef.current = null;
      commitScrollPosition();
    }, SCROLL_COMMIT_DELAY_MS);
  }, [cancelPendingScrollCommit, commitScrollPosition, viewSlot]);

  const getLiveScrollPosition = useCallback(() => liveScrollRef.current, []);

  const handleFilterTypeChange = useCallback((filterType: 'default' | 'album' | 'artist') => {
    library.updateSlot(viewSlot, slot => ({ ...slot, filterType }));
  }, [viewSlot, library.updateSlot]);

  const handleCategoryChange = useCallback((selection: string | null) => {
    library.updateSlot(viewSlot, slot => ({ ...slot, categorySelection: selection }));
  }, [viewSlot, library.updateSlot]);

  return {
    ...library,
    viewSlot,
    setViewSlot,
    slotsRef,
    libraryContentRef,
    pendingSlotLocate,
    cloudWritable,
    handleSwitchSlot,
    handleSlotContentReady,
    handleSlotLocatePrepared,
    handleLibraryScrollPositionChange,
    getLiveScrollPosition,
    handleFilterTypeChange,
    handleCategoryChange,
  };
}
