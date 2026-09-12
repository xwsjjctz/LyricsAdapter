# macOS FocusMode Liquid Glass

FocusMode uses a compact native floating playback bar with inline volume controls when
running on macOS 26+ with a bridge built against the macOS 26 SDK. Windows, Linux,
older macOS and missing/outdated native bridges retain the existing web controls.

## Ownership

- `useFocusGlassControls.ts` synchronizes presentation state at four playback clock updates per second, sampling the DOM rectangle and
  effective opacity at display frequency only during transitions/resizing and routes native actions through the existing player callbacks.
  Changing the surface does not create an audio player or alter library state.
- `focusGlassHandlers.ts` validates payloads and binds a surface to its owning main
  frame. Reloading or destroying that frame releases native views and callbacks.
- `native/macos-statusbar-native/src/focusGlass.mm` implements an independent
  AppKit surface within the existing macOS Node-API package. It adds
  `NSGlassEffectView` siblings above Chromium's content, placing buttons, sliders
  and labels in the glass's supported `contentView` slot. No private APIs, second
  renderer, screenshot-based backgrounds or playback timers are used.
- The view is centered relative to the native content bounds, follows window
  resizing and scales with FocusMode. Its transparent host passes hits outside
  the controls through to Chromium. Playback position is committed on slider
  release; incoming position updates do not overwrite a slider during a drag.
- Native geometry/opacity follows the actual DOM transition, including entry,
  exit, auto-hide and reversals. There is no independent native fade. The compact
  420 × 96 pt bar contains seek, playback mode, transport, mute and volume slider;
  volume does not open a second surface. Theme-transition overrides preserve
  Tailwind’s separate `translate` animation; Reduced Motion disables the page and
  controls transitions together. AppKit adapts glass to contrast and
  transparency preferences, with an opaque backing for Reduce Transparency.
- Menu-bar lyrics reuse their visible-rect tracking area and reconcile hover with
  the current pointer position after playback updates. Spurious tracking exits
  cannot replace controls with lyrics while the pointer remains inside.


## Color decisions

The cover/background supplies the atmosphere. Glass remains untinted and uses
its regular style for legibility over changing artwork. Labels and ordinary
controls use semantic monochrome colors; the active playback mode uses the system
accent. Avoid independently tinting every control or matching colored labels to
similar colors in the artwork.

References: [Apple Color guidance](https://developer.apple.com/design/human-interface-guidelines/color),
[Materials](https://developer.apple.com/design/human-interface-guidelines/materials),
[NSGlassEffectView](https://developer.apple.com/documentation/appkit/nsglasseffectview).

## Verification

```bash
npm run native:rebuild:macos-statusbar
npm run check
npm run test:e2e:run -- electron.focus-glass.spec.ts electron.focus-memory.spec.ts
```

The native E2E requires macOS 26 and the native build's Electron headers. It compiles
an AppKit test probe into a temporary directory, activates real controls and checks
playback, seeking, inline volume, animation alignment, resizing, visibility and teardown.
An isolated AppKit window also checks 100 menu-bar playback/layout/exit cycles
with the pointer held inside, then verifies a genuine exit with isolated user data.
The probe is never shipped. `FOCUS_GLASS_SCREENSHOTS=1` additionally captures only
the test window with `screencapture` (requires existing screen recording access).
Playwright's renderer screenshots alone cannot include AppKit overlays.

`LYRICS_ADAPTER_DISABLE_NATIVE_GLASS=1` explicitly exercises the web fallback;
the general smoke and lyric-animation tests use this while the dedicated native
spec covers the new surface. Windows rendering and pre-macOS-26 execution still
need their respective platform checks; no OS accessibility preferences are changed
by the tests.
