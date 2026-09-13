import { useEffect, useState, type HTMLAttributes } from 'react';
import { getDesktopAPI } from '../services/desktopAdapter';
import type { AppSymbol, PlaybackSymbol, PlaybackSymbols } from '../types/focusGlass';

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

/** Replace every Material glyph in the macOS renderer with its cached SF Symbol mask. */
export function useMacSystemIcons(): void {
  const symbols = usePlaybackSymbols();
  useEffect(() => {
    if (getDesktopAPI()?.platform !== 'darwin' || Object.keys(symbols).length === 0) return;
    const decorate = (icon: HTMLElement) => {
      const name = icon.textContent?.trim() as AppSymbol | undefined;
      const image = name ? symbols[name] : undefined;
      if (!image) {
        delete icon.dataset['macosSystemIcon'];
        icon.style.removeProperty('--macos-system-icon-image');
        return;
      }
      icon.dataset['macosSystemIcon'] = name;
      icon.style.setProperty('--macos-system-icon-image', `url("${image}")`);
    };
    const decorateTree = (node: Node) => {
      if (node instanceof HTMLElement && node.classList.contains('material-symbols-outlined')) decorate(node);
      if (node instanceof Element || node instanceof DocumentFragment) {
        node.querySelectorAll<HTMLElement>('.material-symbols-outlined').forEach(decorate);
      }
    };
    decorateTree(document.body);
    const observer = new MutationObserver(records => {
      for (const record of records) {
        if (record.type === 'characterData' && record.target.parentElement) decorate(record.target.parentElement);
        record.addedNodes.forEach(decorateTree);
      }
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
  }, [symbols]);
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
