// Electron hiddenInset uses a (12, 11) native inset. On macOS 26
// (Darwin 25), AppKit changed the button frames to 14px with a 23px pitch.
// Keep the fourth light and sidebar toggle on the native controls' centerline.
const legacyLayout = {
  height: 38,
  dotLeft: 73,
  dotSize: 12.4,
  sidebarLeft: 88,
} as const;

const tahoeLayout = {
  height: 36,
  dotLeft: 81,
  dotSize: 14,
  sidebarLeft: 97,
} as const;

export function getMacTitleBarLayout(osRelease?: string) {
  const darwinMajor = Number.parseInt(osRelease ?? '', 10);
  return darwinMajor >= 25 ? tahoeLayout : legacyLayout;
}
