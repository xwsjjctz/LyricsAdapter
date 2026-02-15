# Metaflac Binaries

This directory contains the `metaflac` command-line tool binaries for different platforms. These binaries are required for writing FLAC metadata with smart padding support.

## Directory Structure

```
binaries/
├── darwin-arm64/    # macOS Apple Silicon (M1/M2/M3)
│   └── metaflac
├── darwin-x64/      # macOS Intel
│   └── metaflac
├── win32-x64/       # Windows 64-bit
│   └── metaflac.exe
└── linux-x64/       # Linux 64-bit
    └── metaflac
```

## How to Obtain Metaflac Binaries

### macOS

#### Option 1: Using Homebrew (Recommended)
```bash
# Install FLAC package (includes metaflac)
brew install flac

# Copy the binary to the project
# For Apple Silicon (M1/M2/M3):
cp /opt/homebrew/bin/metaflac binaries/darwin-arm64/metaflac

# For Intel Macs:
cp /usr/local/bin/metaflac binaries/darwin-x64/metaflac

# Make it executable
chmod +x binaries/darwin-arm64/metaflac
chmod +x binaries/darwin-x64/metaflac
```

#### Option 2: Build from Source
Download from https://github.com/xiph/flac/releases

### Windows

1. Download the FLAC Windows binary from: https://github.com/xiph/flac/releases
2. Extract the zip file
3. Copy `metaflac.exe` to `binaries/win32-x64/metaflac.exe`

### Linux

#### Debian/Ubuntu
```bash
sudo apt-get install flac
cp /usr/bin/metaflac binaries/linux-x64/metaflac
chmod +x binaries/linux-x64/metaflac
```

#### Fedora/RHEL
```bash
sudo dnf install flac
cp /usr/bin/metaflac binaries/linux-x64/metaflac
chmod +x binaries/linux-x64/metaflac
```

#### Arch Linux
```bash
sudo pacman -S flac
cp /usr/bin/metaflac binaries/linux-x64/metaflac
chmod +x binaries/linux-x64/metaflac
```

## Development Mode

In development mode (`npm run electron:dev`), the app will try to use the system `metaflac` if available. This means you can develop without copying the binaries, as long as `metaflac` is installed on your system and in your PATH.

## Production Builds

For production builds, the bundled binaries in this directory will be used. Make sure all platform binaries are present before building:
```bash
npm run electron:build
```

## Why Metaflac?

We use `metaflac` instead of pure JavaScript libraries because:
1. **Smart Padding**: Metaflac intelligently handles padding in FLAC files, which is crucial for non-standard FLAC files (like those from QQ Music)
2. **Reliability**: The official FLAC tools are battle-tested and handle edge cases properly
3. **File Integrity**: Properly preserves FLAC file structure and metadata

Future work may include implementing smart padding in pure JavaScript to remove this dependency.
