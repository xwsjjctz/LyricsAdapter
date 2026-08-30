# LyricsAdapter Windows taskbar lyrics helper

This is an intentionally separate, dependency-free .NET 8/WPF process. Electron
sends playback snapshots on stdin and receives playback intents on stdout. The
helper owns all Explorer-window lifecycle and Win32 behavior.

## Protocol

Messages are one UTF-8 JSON object per line (NDJSON).

Electron to helper:

```json
{"type":"update","state":{"trackId":"id","title":"Song","artist":"Artist","line":"Current line","nextLine":"Next line","isPlaying":true}}
{"type":"stop"}
```

Helper to Electron:

```json
{"type":"action","action":"toggle-play"}
{"type":"action","action":"previous"}
{"type":"action","action":"next"}
```

Diagnostics use stderr and never share the protocol stream.

## Build and package

The repository's `npm run electron:build:win` and
`npm run electron:build:win:arm64` commands publish the matching helper first
and then let electron-builder copy it into the application resources. The .NET
8 SDK is therefore required only on the packaging machine.

For a direct helper-only build:

```powershell
dotnet publish .\native\windows-taskbar-lyrics\LyricsAdapter.TaskbarLyrics.csproj `
  -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true
```

Publish `win-arm64` separately for Windows on ARM. Package the resulting
`LyricsAdapter.TaskbarLyrics.exe` at:

```text
resources/native/windows-taskbar-lyrics/LyricsAdapter.TaskbarLyrics.exe
```

For development, `LYRICS_ADAPTER_TASKBAR_LYRICS_HELPER` may point at an explicit
published executable.

## Hosting behavior

- The window switches from `WS_POPUP` to `WS_CHILD` and calls `SetParent` with
  `Shell_TrayWnd` or `Shell_SecondaryTrayWnd`.
- `TrayNotifyWnd` is the preferred positioning anchor. Windows 11 secondary
  taskbars may not expose that child, so a background UI Automation lookup for
  `SystemTrayIcon` / `SystemTrayFrameGrid` is used as a read-only fallback.
- `TaskbarCreated`, display/settings notifications, and a 1.25-second health
  check recover from Explorer restarts and display topology changes.
- The process is Per-Monitor-V2 DPI aware. Native pixel positions are derived
  from the selected taskbar's DPI.
- If parenting or embedded positioning fails, if a vertical taskbar is used, or
  if an auto-hidden taskbar is too thin to host the control, the same window is
  shown as a non-activating topmost overlay just above/beside that taskbar.

The default target is the primary taskbar. `--monitor=cursor` follows the monitor
containing the pointer, and `--monitor=N` selects a zero-based taskbar from the
stable primary-first, then left-to-right/top-to-bottom ordering.

`SetParent` across processes is an implementation technique, not a documented
Windows taskbar-extension contract. The overlay fallback is therefore part of
the supported behavior, not merely an error screen.
