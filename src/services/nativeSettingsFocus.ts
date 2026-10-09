let keyboardOwned = false;

/**
 * True while the native macOS settings panel is open. It is a child panel of
 * the player window and takes the keyboard, so the page receives `blur`
 * although the player is still the app's main window; window-focus indicators
 * should ignore that blur, as they do for the native command palette.
 */
export function nativeSettingsOwnsKeyboard(): boolean {
  return keyboardOwned;
}

export function setNativeSettingsOwnsKeyboard(owned: boolean): void {
  keyboardOwned = owned;
}
