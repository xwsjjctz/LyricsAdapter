# Third-Party Notices

This file records third-party source and design acknowledgements for
LyricsAdapter. It supplements, and does not replace, the project-wide
[GNU General Public License version 3](LICENSE).

## FluentFlyout

The visual proportions and interaction design of LyricsAdapter's Windows
taskbar-adjacent lyrics overlay are adapted from FluentFlyout's taskbar widget.

- Upstream project: [unchihugo/FluentFlyout](https://github.com/unchihugo/FluentFlyout)
- Reviewed upstream branch: `master`
- Reviewed upstream revision:
  [`cc1afce4b89aace919759195f56e8aedee58e4f2`](https://github.com/unchihugo/FluentFlyout/commit/cc1afce4b89aace919759195f56e8aedee58e4f2)
- Upstream source license: [GPL-3.0-or-later](https://github.com/unchihugo/FluentFlyout/blob/cc1afce4b89aace919759195f56e8aedee58e4f2/LICENSE)
- Upstream source notice: `Copyright (c) 2024-2026 The FluentFlyout Authors`
- Additional upstream repository notice: `Copyright (C) 2025 Hugo Li`
- LyricsAdapter modification/adaptation date: 2026-08-31

Relevant upstream source reviewed at that revision:

- [`FluentFlyoutWPF/Controls/TaskbarWidgetControl.xaml`](https://github.com/unchihugo/FluentFlyout/blob/cc1afce4b89aace919759195f56e8aedee58e4f2/FluentFlyoutWPF/Controls/TaskbarWidgetControl.xaml)
- [`FluentFlyoutWPF/Controls/TaskbarWidgetControl.xaml.cs`](https://github.com/unchihugo/FluentFlyout/blob/cc1afce4b89aace919759195f56e8aedee58e4f2/FluentFlyoutWPF/Controls/TaskbarWidgetControl.xaml.cs)

The adapted design details include the compact 40-pixel surface, rounded
corners, inset top highlight, cover-art placement, lyric text hierarchy, and
light/dark hover transitions. LyricsAdapter implements those ideas with its
own Electron window, HTML, CSS, and TypeScript rather than FluentFlyout's WPF
or native taskbar-hosting code.

The acknowledgement applies principally to these LyricsAdapter implementation
targets and their later revisions:

- `electron/services/windowsTaskbarLyricsService.ts`
- `electron/services/systemLyricsCoordinator.ts`
- `taskbar-lyrics.html`
- `src/taskbar-lyrics/`

The Windows surface is a taskbar-adjacent transparent Electron overlay. It does
not ship a C#/.NET helper and does not use FluentFlyout binaries, branding, or
native taskbar-parenting implementation. LyricsAdapter, including this adapted
design, continues to be distributed under GNU GPL version 3. Existing upstream
copyright and license notices must be preserved in copied or derived source.

No FluentFlyout name, logo, screenshots, icons, or other branding assets are
incorporated into LyricsAdapter by this acknowledgement.

## Corresponding Source

The complete preferred form for modifying LyricsAdapter is maintained in the
[LyricsAdapter source repository](https://github.com/xwsjjctz/LyricsAdapter),
including the Electron service and taskbar-overlay renderer assets. For a
distributed binary, use the source revision or source archive associated with
that release. If the matching source cannot be located, open an issue in the
source repository.

This notice does not replace any license or attribution files required by
third-party libraries that are separately packaged with LyricsAdapter.
