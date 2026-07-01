import { useCallback, useEffect, useRef, useState } from 'react';
import { useGsapSlotTransition } from '../hooks/useGsapSlotTransition';
import { useLibrarySlots } from '../hooks/useLibrarySlots';
import { webdavClient } from '../services/webdavClient';

export type LibrarySlotId = 'local' | 'cloud' | 'online';

export function useLibraryStore() {
  const library = useLibrarySlots();
  const [viewSlot, setViewSlot] = useState<LibrarySlotId>('local');
  const { containerRef: libraryContentRef, switchSlot: transitionToSlot, completeEnter: completeSlotEnter } = useGsapSlotTransition(viewSlot, setViewSlot);
  const [pendingSlotLocate, setPendingSlotLocate] = useState<{ token: number; slot: LibrarySlotId } | null>(null);
  const [cloudWritable, setCloudWritable] = useState<boolean | null>(null);
  const slotLocateTokenRef = useRef(0);
  const lastScrollPositionRef = useRef(0);
  const slotsRef = useRef(library.slots);
  slotsRef.current = library.slots;

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
    library.updateSlot(viewSlot, slot => ({ ...slot, scrollPosition: lastScrollPositionRef.current }));
    if (options?.locateCurrentTrack) {
      setPendingSlotLocate({ token: ++slotLocateTokenRef.current, slot: targetSlot });
    }
    await transitionToSlot(targetSlot);
  }, [viewSlot, library.updateSlot, transitionToSlot]);

  const handleSlotContentReady = useCallback((slot: LibrarySlotId) => {
    completeSlotEnter(slot);
  }, [completeSlotEnter]);

  const handleSlotLocatePrepared = useCallback((token: number) => {
    setPendingSlotLocate(current => current?.token === token ? null : current);
  }, []);

  const handleLibraryScrollPositionChange = useCallback((position: number) => {
    lastScrollPositionRef.current = position;
    library.updateSlot(viewSlot, slot => ({ ...slot, scrollPosition: position }));
  }, [viewSlot, library.updateSlot]);

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
    handleFilterTypeChange,
    handleCategoryChange,
  };
}
