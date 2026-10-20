let keyboardOwned = false;

/**
 * True while the native macOS settings sheet is open. Its AppKit controls take
 * the keyboard inside the player window, so the page receives `blur` although
 * the window is still key; window-focus indicators should ignore that blur, as
 * they do for the native command palette.
 */
export function nativeSettingsOwnsKeyboard(): boolean {
  return keyboardOwned;
}

export function setNativeSettingsOwnsKeyboard(owned: boolean): void {
  keyboardOwned = owned;
}
