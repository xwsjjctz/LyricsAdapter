# FLAC Tool Binaries

This directory can contain optional command-line binaries used by Electron main process:

- `ffmpeg`: preferred path for FLAC metadata writing (cross-platform remux)
- `metaflac`: fallback path when ffmpeg is not available

## Directory Structure

```text
binaries/
├── darwin-arm64/    # macOS Apple Silicon (M1/M2/M3)
│   ├── ffmpeg
│   └── metaflac
├── darwin-x64/      # macOS Intel
│   ├── ffmpeg
│   └── metaflac
├── win32-x64/       # Windows 64-bit
│   ├── ffmpeg.exe
│   └── metaflac.exe
└── linux-x64/       # Linux 64-bit
    ├── ffmpeg
    └── metaflac
```

## Runtime Resolution Order

The app resolves binaries in this order:

1. Bundled binary under `binaries/<platform>/`
2. System binary from `PATH`

For FLAC metadata writes, runtime tries:

1. `ffmpeg` remux (primary)
2. `metaflac` (fallback)

## Development Mode

In development (`npm run electron:dev`), you can rely on system binaries from `PATH`.

## Production Builds

For packaged apps, ship platform binaries via `extraResources` so users do not need to install tools manually.
