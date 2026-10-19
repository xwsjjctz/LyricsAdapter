import { useCallback, useEffect, useRef, useState } from 'react';
import type { SettingsMessageTone } from '../SettingsMessage';

const SUCCESS_DURATION_MS = 3000;

export interface SettingsMessageState {
  text: string;
  tone: SettingsMessageTone;
}

/**
 * One rule for every settings action: a success clears itself after a few seconds, an error
 * stays until the next attempt (call `clear` when one starts) so it can be read.
 */
export function useSettingsMessage() {
  const [message, setMessage] = useState<SettingsMessageState | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => () => clearTimeout(timer.current), []);
  const clear = useCallback(() => { clearTimeout(timer.current); setMessage(null); }, []);
  const show = useCallback((text: string, tone: SettingsMessageTone) => {
    clearTimeout(timer.current);
    setMessage({ text, tone });
    if (tone === 'success') timer.current = setTimeout(() => setMessage(null), SUCCESS_DURATION_MS);
  }, []);
  return { message, show, clear };
}
