import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { PaletteCommand } from '../../commands/paletteCommand';
import { PALETTE_MODES, commandPalette, useCommandPaletteState, type CommandPaletteStore } from '../../hooks/useCommandPalette';
import { useDocumentDarkMode, useNativePalette } from '../../hooks/useNativePalette';
import type { NativePaletteAction } from '../../types/nativePalette';
import { dispatchForwardedShortcut, toNativePaletteState } from './nativePaletteState';
import { usePaletteItems, type PaletteItem, type PaletteLibrarySources } from './usePaletteItems';

interface CommandPaletteProps {
  /** Injectable for tests; the app uses the shared store. */
  palette?: CommandPaletteStore;
  commands: readonly PaletteCommand[];
  library: PaletteLibrarySources;
}

/**
 * Keyboard-first entry to every page and feature. Library mode searches
 * music; Shift+Tab switches to feature mode. Handled keys stop propagating
 * so the global shortcuts (Space, Cmd+Enter, …) do not also fire.
 */
export default function CommandPalette({ palette = commandPalette, commands, library }: CommandPaletteProps) {
  const { t } = useTranslation();
  const state = useCommandPaletteState(palette);
  const { items, trail, onlineLoading } = usePaletteItems(state, commands, library);
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const listboxId = useId();

  useEffect(() => { setSelected(0); }, [state.mode, state.query, state.stack]);
  useEffect(() => { if (state.open) inputRef.current?.focus(); }, [state.open, state.mode, state.stack]);
  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${selected}"]`)?.scrollIntoView?.({ block: 'nearest' });
  }, [selected]);

  const activate = useCallback((item: PaletteItem | undefined) => {
    if (!item) return;
    if (item.command) {
      palette.push(item.command);
      return;
    }
    item.run();
    if (!item.keepOpen) palette.close();
  }, [palette]);

  // Input intents shared by the web input and the native macOS field.
  const move = useCallback((delta: number) => {
    setSelected(index => Math.max(0, Math.min(index + delta, items.length - 1)));
  }, [items.length]);
  const backspaceWhenEmpty = useCallback((): boolean => {
    if (state.query || state.stack.length === 0) return false;
    palette.pop();
    return true;
  }, [palette, state.query, state.stack.length]);

  const handleNativeAction = useCallback((action: NativePaletteAction) => {
    switch (action.type) {
      case 'query': palette.setQuery(action.text); return;
      case 'move': move(action.value); return;
      case 'hover': setSelected(action.value); return;
      case 'activate': activate(items[action.value < 0 ? selected : action.value]); return;
      // Tab and Shift+Tab both switch between music and features; Enter opens sub-lists.
      case 'tab':
      case 'cycle-mode': palette.cycleMode(); return;
      case 'mode': if (PALETTE_MODES[action.value] !== state.mode) palette.cycleMode(); return;
      case 'escape': palette.back(); return;
      case 'backspace': backspaceWhenEmpty(); return;
      case 'shortcut': dispatchForwardedShortcut(action.text, action.value); return;
    }
  }, [activate, backspaceWhenEmpty, items, move, palette, selected, state.mode]);

  const darkMode = useDocumentDarkMode();
  const nativeActive = useNativePalette(toNativePaletteState({
    open: state.open,
    darkMode,
    mode: state.mode,
    modes: PALETTE_MODES,
    query: state.query,
    trail,
    loading: onlineLoading,
    selected,
    items,
    t,
  }), handleNativeAction);

  const handleKeyDown = useCallback((event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) return;
    const stop = () => { event.preventDefault(); event.stopPropagation(); };
    switch (event.key) {
      case 'ArrowDown':
        stop();
        move(1);
        return;
      case 'ArrowUp':
        stop();
        move(-1);
        return;
      case 'Enter':
        stop();
        activate(items[selected]);
        return;
      case 'Tab':
        // Tab switches between music and features (Shift+Tab too, as before);
        // Enter opens a feature's sub-list.
        stop();
        palette.cycleMode();
        return;
      case 'Escape':
        stop();
        palette.back();
        return;
      case 'Backspace':
        if (backspaceWhenEmpty()) stop();
        return;
      default:
        // Plain typing stays in the input; keep it away from global shortcuts.
        if (!event.metaKey && !event.ctrlKey && !event.altKey) event.stopPropagation();
    }
  }, [activate, backspaceWhenEmpty, items, move, palette, selected]);

  if (!state.open) return null;
  // The native glass panel draws above the page; the web layer only dims it
  // and closes the palette on an outside click.
  if (nativeActive) {
    return <div className="command-palette-backdrop" data-controlbar-passthrough onMouseDown={palette.close} />;
  }

  const activeId = items[selected] ? `${listboxId}-${selected}` : undefined;
  let previousSection: string | null = null;

  return (
    <div className="command-palette-backdrop" data-controlbar-passthrough onMouseDown={palette.close}>
      <div
        className="command-palette"
        role="dialog"
        aria-modal="true"
        aria-label={t('palette.label')}
        onMouseDown={event => event.stopPropagation()}
      >
        <div className="command-palette__header">
          <div className="command-palette__modes" role="tablist" aria-label={t('palette.modeLabel')}>
            {PALETTE_MODES.map(mode => (
              <button
                key={mode}
                type="button"
                role="tab"
                tabIndex={-1}
                aria-selected={state.mode === mode}
                className="command-palette__mode"
                onClick={() => { if (state.mode !== mode) palette.cycleMode(); }}
              >
                {t(`palette.mode.${mode}`)}
              </button>
            ))}
          </div>
          <span className="command-palette__hint">{t('palette.switchHint')}</span>
        </div>

        <div className="command-palette__search">
          <span className="material-symbols-rounded" aria-hidden="true">
            {state.mode === 'library' ? 'search' : 'bolt'}
          </span>
          {trail.length > 0 && <span className="command-palette__trail">{trail.join(' › ')} ›</span>}
          <input
            ref={inputRef}
            className="command-palette__input"
            value={state.query}
            placeholder={t(`palette.placeholder.${state.mode}`)}
            spellCheck={false}
            autoComplete="off"
            role="combobox"
            aria-expanded="true"
            aria-controls={listboxId}
            aria-activedescendant={activeId}
            onChange={event => palette.setQuery(event.target.value)}
            onKeyDown={handleKeyDown}
          />
          {onlineLoading && <span className="material-symbols-rounded animate-spin command-palette__spinner" aria-label={t('search.searching')}>progress_activity</span>}
        </div>

        <div ref={listRef} id={listboxId} role="listbox" className="command-palette__list no-scrollbar">
          {items.length === 0 && <p className="command-palette__empty">{t('search.noResults')}</p>}
          {items.map((item, index) => {
            const showSection = item.section !== previousSection;
            previousSection = item.section;
            return (
              <div key={item.key}>
                {showSection && <div className="command-palette__section">{item.section}</div>}
                <div
                  id={`${listboxId}-${index}`}
                  data-index={index}
                  role="option"
                  aria-selected={index === selected}
                  className="command-palette__item"
                  onMouseMove={() => { if (index !== selected) setSelected(index); }}
                  onClick={() => activate(item)}
                >
                  <span className="command-palette__icon" aria-hidden="true">
                    {item.coverUrl
                      ? <img src={item.coverUrl} alt="" loading="lazy" />
                      : <span className="material-symbols-rounded">{item.icon}</span>}
                  </span>
                  <span className="command-palette__text">
                    <span className="command-palette__title">{item.title}</span>
                    {item.subtitle && <span className="command-palette__subtitle">{item.subtitle}</span>}
                  </span>
                  {item.detail && <span className="command-palette__detail">{item.detail}</span>}
                  {item.shortcut && <kbd className="command-palette__kbd">{item.shortcut}</kbd>}
                  {item.command && <span className="material-symbols-rounded command-palette__chevron" aria-hidden="true">chevron_right</span>}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
