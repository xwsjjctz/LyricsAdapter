import { useCallback, useEffect, useRef, useState } from 'react';

/** Bridge the small pointer gap between Chromium and the AppKit slider. */
export function useVolumeDisclosure(visible: boolean) {
  const [expanded, setExpanded] = useState(false);
  const nativeInside = useRef(false);
  const domInside = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const cancel = useCallback(() => { clearTimeout(timer.current); }, []);
  const open = useCallback(() => { cancel(); setExpanded(true); }, [cancel]);
  const closeSoon = useCallback(() => {
    cancel();
    timer.current = setTimeout(() => { if (!nativeInside.current && !domInside.current) setExpanded(false); }, 160);
  }, [cancel]);
  const onNativePresence = useCallback((inside: boolean) => {
    nativeInside.current = inside;
    if (inside) open(); else closeSoon();
  }, [open, closeSoon]);
  const enter = useCallback(() => { domInside.current = true; cancel(); }, [cancel]);
  const leave = useCallback(() => { domInside.current = false; closeSoon(); }, [closeSoon]);
  useEffect(() => {
    if (!visible) { cancel(); nativeInside.current = false; domInside.current = false; setExpanded(false); }
  }, [visible, cancel]);
  useEffect(() => cancel, [cancel]);
  return { expanded: visible && expanded, open, closeSoon, enter, leave, onNativePresence };
}
