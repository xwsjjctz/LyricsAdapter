// Electron hiddenInset uses a (12, 11) native inset. On macOS 26
// (Darwin 25), AppKit changed the button frames to 14px with a 23px pitch.
// Keep the fourth light and sidebar toggle on the native controls' centerline.
// macOS 27 (Darwin 27) renders the traffic lights with a glossy, domed finish,
// so the fourth light mirrors that on those releases.
const legacyLayout = {
  height: 38,
  dotLeft: 73,
  dotSize: 12.4,
  sidebarLeft: 88,
  glossy: false,
} as const;

const tahoeLayout = {
  height: 36,
  dotLeft: 81,
  dotSize: 14,
  sidebarLeft: 97,
  glossy: false,
} as const;

const glossyTahoeLayout = {
  ...tahoeLayout,
  glossy: true,
} as const;

export function getMacTitleBarLayout(osRelease?: string) {
  const darwinMajor = Number.parseInt(osRelease ?? '', 10);
  if (darwinMajor >= 27) return glossyTahoeLayout;
  return darwinMajor >= 25 ? tahoeLayout : legacyLayout;
}
