import { useEffect, useState, type HTMLAttributes } from 'react';
import { getDesktopAPI } from '../services/desktopAdapter';
import type { PlaybackSymbol, PlaybackSymbols } from '../types/focusGlass';

type SymbolAPI = NonNullable<ReturnType<typeof getDesktopAPI>>;
const requests = new WeakMap<SymbolAPI, Promise<PlaybackSymbols>>();

/** One small, cached palette per desktop bridge; never poll during playback. */
export function usePlaybackSymbols(): PlaybackSymbols {
  const [symbols, setSymbols] = useState<PlaybackSymbols>({});
  useEffect(() => {
    const desktop = getDesktopAPI();
    const read = desktop?.ipc?.focusGlass?.getPlaybackSymbols;
    if (desktop?.platform !== 'darwin' || !read) return;
    let request = requests.get(desktop);
    if (!request) {
      request = read().then(result => result.ok ? result.data : {}).catch(() => ({}));
      requests.set(desktop, request);
    }
    let cancelled = false;
    void request.then(value => { if (!cancelled) setSymbols(value); });
    return () => { cancelled = true; };
  }, []);
  return symbols;
}

interface Props extends HTMLAttributes<HTMLSpanElement> {
  name: PlaybackSymbol;
  symbols: PlaybackSymbols;
}

/** Preserve the original glyph/layout when the system palette is unavailable. */
export function PlaybackIcon({ name, symbols, className, style, ...props }: Props) {
  const image = symbols[name];
  if (!image) return <span {...props} className={className} style={style}>{name}</span>;
  return <span {...props} className={className} data-system-symbol={name} style={{
    ...style, display: 'inline-block', width: '1em', height: '1em', flexShrink: 0,
    verticalAlign: 'middle', backgroundColor: 'currentColor',
    maskImage: `url("${image}")`, maskSize: 'contain', maskPosition: 'center', maskRepeat: 'no-repeat',
  }} />;
}
