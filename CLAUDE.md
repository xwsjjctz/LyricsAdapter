# CLAUDE.md

Guidance for Claude Code when working in this repository.

## Commands

```bash
npm run electron:dev          # Vite + Electron dev mode
npm run dev                   # Browser-only Vite dev server
npm run build                 # Production renderer build
npm run electron:build        # Build for the current platform
npm run electron:build:mac    # Build macOS DMG
npm run electron:build:win    # Build Windows x64 installer
npm run electron:build:linux  # Build Linux AppImage
npx tsc --noEmit              # Type-check only
```

No test runner or linter is configured. `test/` is gitignored.

## Architecture

LyricsAdapter is an Electron + React + Vite desktop music player.

- Main process (`electron/`): window creation, IPC, file I/O, `cover://`, QQ Music proxying, and WebDAV proxying. The window is frameless.
- Renderer (`./`): React 18 function components and hooks. No Redux, Zustand, or other global state store.
- Preload (`electron/preload.ts`): exposes typed `window.electron`; all main/renderer communication goes through this bridge.
- Desktop adapter (`services/desktopAdapter.ts`): renderer code must use `getDesktopAPI()`, `getDesktopAPIAsync()`, and `isDesktop()` instead of touching `window.electron` directly. Browser mode falls back to HTML file inputs where needed.

## Playback Model

- `useLibrarySlots.ts` owns two independent slots: `local` for imported files and `cloud` for WebDAV or QQ Music downloads.
- Each slot stores tracks, current index, time, volume, playback mode, scroll position, and filters.
- Switching slots restores that slot state and always sets `isPlaying` to `false`.

## Data Flow

- Import: IPC file dialog -> `metadataService` -> `coverArtService` -> `Track` objects -> `libraryStorage` -> `userData/library-index.json`.
- Playback: `selectTrack` -> lazy IPC file read -> Blob URL -> HTML audio element -> delayed adjacent-track preload.
- WebDAV: PROPFIND browse -> redirect URL -> proxied HTTP range requests -> streamed `Track` with `source: 'webdav'`.
- Track identity is path-based: `filePath` for local tracks, `webdavPath` for cloud tracks. `id` is derived from that path.
- Covers are cached in `userData/covers/` and served as `cover://<track-id>`.

## Conventions

- `@/` maps to the project root.
- Use `services/logger.ts` instead of `console.log`.
- Use `flac-metadata` for FLAC writes; `music-metadata` is read-only.
- Use `node-id3` for MP3 tag writes.
- Window drag regions live in `TitleBar.tsx`.
- Build outputs: `dist/`, `dist-electron/`, and `release/`.
- Do not launch `npm run dev`, `npm run electron:dev`, or the app unless explicitly asked.

## Git

- Never commit directly on `master`; create a focused branch first.
- Branch prefixes: `feature/`, `fix/`, `refactor/`, `docs/`, `perf/`.
- Commit messages use conventional prefixes: `feat`, `fix`, `refactor`, `docs`, `chore`, `perf`, `ci`. Follow `.claude/COMMIT_CONVENTION.md` for the house style.
- Push work with `git push -u origin <branch-name>` and merge through a PR.

## Release

- PRs to `master` run `npx tsc --noEmit`.
- Pushing a `v*` tag builds macOS and Windows release artifacts.
- `v0.*` tags are prereleases; `v1.*` and later are stable releases.
- Only create or push release tags when the user explicitly asks.
