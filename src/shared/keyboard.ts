import type { KeyboardEvent } from 'react';

/**
 * Enter with no modifier keys. Focusable song rows and tiles activate only on
 * this: element handlers run before the window-level shortcut listener, so
 * accepting Cmd/Ctrl/Alt/Shift+Enter would replay the focused song whenever a
 * shortcut such as Cmd+Enter (focus mode) is pressed.
 */
export function isPlainEnter(event: KeyboardEvent): boolean {
  return event.key === 'Enter' && !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey;
}
