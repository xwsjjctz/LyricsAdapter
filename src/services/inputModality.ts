/**
 * Tracks whether the user is driving the UI with a pointer or the keyboard.
 *
 * Chromium shows :focus-visible rings when script moves focus (menus, dialogs),
 * even right after a mouse click. The current modality is mirrored onto
 * `<html data-input-modality>` so CSS can hide rings for pointer users, and
 * components can skip moving focus onto a specific control after a click.
 */

export type InputModality = 'keyboard' | 'pointer';

const MODIFIER_KEYS = new Set(['Meta', 'Control', 'Alt', 'Shift', 'CapsLock', 'Fn']);

let modality: InputModality = 'keyboard';

const apply = (next: InputModality) => {
  modality = next;
  document.documentElement.dataset['inputModality'] = next;
};

const onPointerDown = () => apply('pointer');

const onKeyDown = (event: KeyboardEvent) => {
  // Shortcuts (Cmd+K, Ctrl+Space…) and bare modifiers are not keyboard navigation.
  if (MODIFIER_KEYS.has(event.key) || event.metaKey || event.ctrlKey || event.altKey) return;
  apply('keyboard');
};

/** Start tracking; returns a disposer. Safe to call more than once. */
export function installInputModality(): () => void {
  apply('keyboard');
  document.addEventListener('pointerdown', onPointerDown, true);
  document.addEventListener('keydown', onKeyDown, true);
  return () => {
    document.removeEventListener('pointerdown', onPointerDown, true);
    document.removeEventListener('keydown', onKeyDown, true);
  };
}

export function lastInputWasKeyboard(): boolean {
  return modality === 'keyboard';
}
