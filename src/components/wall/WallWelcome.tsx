import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { getDesktopAPI } from '../../services/desktopAdapter';
import { shortcutManager, type ShortcutAction } from '../../services/shortcuts';

interface WallWelcomeProps {
  /** Opens the file picker; absent while importing is unavailable. */
  onImport?: (() => void) | undefined;
}

/** The three keys worth knowing on day one; the command palette lists everything else. */
const KEYS: { action: ShortcutAction; labelKey: string }[] = [
  { action: 'toggleCommandPalette', labelKey: 'welcome.palette' },
  { action: 'playPause', labelKey: 'welcome.playPause' },
  { action: 'toggleFocusMode', labelKey: 'welcome.focus' },
];

const MAC_KEYS: Record<string, string> = { CmdOrCtrl: '⌘', Alt: '⌥', Shift: '⇧', Enter: '↩' };
const OTHER_KEYS: Record<string, string> = { CmdOrCtrl: 'Ctrl' };
const COMMON_KEYS: Record<string, string> = { Backquote: '`', Left: '←', Right: '→', Up: '↑', Down: '↓', Escape: 'Esc' };

/** A stored binding such as `CmdOrCtrl+Enter` as key caps for this platform. */
function keyCaps(binding: string, mac: boolean, space: string): string[] {
  return binding.split('+').map(part => (mac ? MAC_KEYS[part] : OTHER_KEYS[part]) ?? COMMON_KEYS[part] ?? (part === 'Space' ? space : part));
}

/**
 * First page of an empty library: what to do next and the few keys that open the rest.
 * Teaching the command palette is enough, since it shows every command with its shortcut.
 * Bindings come from the user's shortcut settings, so a remapped key reads correctly.
 */
export default function WallWelcome({ onImport }: WallWelcomeProps) {
  const { t } = useTranslation();
  const keysId = useId();
  const mac = getDesktopAPI()?.platform === 'darwin';
  const shortcuts = shortcutManager.getAllShortcuts();
  const keys = KEYS.flatMap(entry => {
    const binding = shortcuts[entry.action]?.currentKey;
    return binding ? [{ ...entry, caps: keyCaps(binding, mac, t('welcome.space')) }] : [];
  });
  return (
    <div className="wall-welcome" data-testid="wall-welcome">
      <p className="wall-welcome__eyebrow">LyricsAdapter</p>
      <h1 className="wall-welcome__title">{t('welcome.title')}</h1>
      <p className="wall-welcome__lead">{t('welcome.lead')}</p>
      {onImport && (
        <button type="button" className="wall-float wall-float__button wall-empty-action" onClick={onImport}>
          <span className="material-symbols-rounded" aria-hidden="true">library_add</span>
          {t('sidebar.importFiles')}
        </button>
      )}
      {keys.length > 0 && (
        <section className="wall-welcome__keys" aria-labelledby={keysId}>
          <h2 id={keysId} className="wall-welcome__keys-title">{t('welcome.keysTitle')}</h2>
          <dl>
            {keys.map(entry => (
              <div key={entry.action} className="wall-welcome__key-row">
                <dt className="wall-welcome__caps">{entry.caps.map((cap, index) => <kbd key={index}>{cap}</kbd>)}</dt>
                <dd>{t(entry.labelKey)}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}
    </div>
  );
}
