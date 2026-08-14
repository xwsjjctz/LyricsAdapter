# AGENTS.md

Guidance for Codex when working in this repository.

## Commands

```bash
npm run dev                   # Browser-only Vite dev server
npm run electron:dev          # Vite + Electron, normal development
npm run electron:debug        # Electron + renderer CDP :9222 + main inspector :9229
npm run build                 # Production renderer build
npm run typecheck             # Strict TypeScript check
npm run typecheck:e2e         # Type-check Playwright config and Electron E2E
npm test                      # Vitest unit suite
npm run test:e2e              # Built Electron + preload + IPC smoke test
npm run check                 # Typecheck + unit tests + production build
npm run electron:build        # Build for the current platform
npm run electron:build:mac    # Build macOS DMG
npm run electron:build:win    # Build Windows x64 installer
npm run electron:build:linux  # Build Linux AppImage
```

Vitest tests live under `test/**/*.test.{ts,tsx}`. The Playwright Electron smoke
test lives under `test/e2e/**/*.spec.ts`. No linter is currently configured.

## Architecture

LyricsAdapter is an Electron + React + Vite desktop music player.

- Main process (`electron/`): window creation, IPC, file I/O, `cover://`, QQ Music proxying, and WebDAV proxying. The window is frameless.
- Renderer (`src/`): React 18 function components, hooks, controllers, viewmodels, services, and hook-based stores.
- Preload (`electron/preload.ts`): exposes typed `window.electron`; all main/renderer communication goes through this bridge.
- Desktop adapter (`src/services/desktopAdapter.ts`): renderer code must use `getDesktopAPI()`, `getDesktopAPIAsync()`, and `isDesktop()` instead of touching `window.electron` directly. Browser mode falls back to HTML file inputs where needed.

## Debugging Model

- Normal `electron:dev` does not expose remote debugging ports.
- `electron:debug` exposes renderer CDP on `127.0.0.1:9222` and the Electron main-process Node inspector on `127.0.0.1:9229`.
- `.codex/config.toml` configures Codex, while `.mcp.json` covers Claude and compatible clients; both attach the development-only Playwright MCP server to the running Electron renderer over CDP. Neither is bundled into the application.
- CDP only covers Chromium renderer targets. Use `.vscode/launch.json` (or another Node inspector client) for main-process breakpoints.
- `test:e2e` builds the app, launches real Electron against `app://`, verifies preload and IPC, and isolates every data path in a temporary directory.
- See `DEBUGGING.md` for the complete Agent workflow and troubleshooting steps.

## Playback Model

- `useLibrarySlots.ts` owns four independent slots: `local`, `cloud`, `online`, and the play-only `playlist` context.
- Each slot stores tracks, current index, time, volume, playback mode, scroll position, and filters.
- Switching slots restores that slot state and always sets `isPlaying` to `false`.

## Data Flow

- Import: IPC file dialog -> `metadataService` -> `coverArtService` -> `Track` objects -> `libraryStorage` -> `userData/library-index.json`.
- Playback: `selectTrack` -> lazy IPC file read -> Blob URL -> HTML audio element -> delayed adjacent-track preload.
- WebDAV: PROPFIND browse -> redirect URL -> proxied HTTP range requests -> streamed `Track` with `source: 'webdav'`.
- Track identity is path-based: `filePath` for local tracks, `webdavPath` for cloud tracks. `id` is derived from that path.
- Covers are cached in `userData/covers/` and served as `cover://<track-id>`.

## Ownership Boundaries

- Do not add new business logic to `AppWorkspace.tsx`; keep it as wiring/composition only and move domain behavior into the appropriate controller, hook, or service.
- UI components must not call `updateSlot` or mutate slot state directly. They should emit user intent through props/callbacks and let controllers own state changes.
- Playback behavior must go through the player controller. Do not start, stop, seek, switch tracks, or alter playback state from UI components, providers, or unrelated services.
- Library mutations must go through the library controller. Imports, removals, metadata updates, slot changes, and persistence-triggering changes belong there.
- Online music providers must not control the player directly. Providers may fetch/search/normalize/download/stream metadata and return results; playback intent is handled by the player controller.
- Before implementing a new feature, first state the feature domain, the exact state read/write scope, and the files expected to be affected. Keep the implementation inside those boundaries unless the codebase proves the scope must change.

## Conventions

- `@/` maps to `src/`.
- Use `src/services/logger.ts` instead of `console.log`.
- Use the existing `music-tag-native` bridge for audio metadata reads/writes; keep legacy MP3 behavior on `node-id3` unless deliberately migrating it.
- Window drag regions live in `TitleBar.tsx`.
- Build outputs: `dist/`, `dist-electron/`, and `release/`.
- Agent tools may launch `npm run dev`, `npm run electron:dev`, or `npm run electron:debug` when debugging requires a live process. Do not leave unnecessary dev-server or Electron processes running after the task is complete.
- Generated MCP artifacts in `.playwright-mcp/` and the local CodeGraph index in `.codegraph/` stay untracked.

## Git

- Never commit directly on `master`; create a focused branch first.
- Branch prefixes: `feature/`, `fix/`, `refactor/`, `docs/`, `perf/`.
- Commit messages use conventional prefixes: `feat`, `fix`, `refactor`, `docs`, `chore`, `perf`, `ci`. Follow `.claude/COMMIT_CONVENTION.md` for the house style.
- Push work with `git push -u origin <branch-name>` and merge through a PR.

## Release

- PRs to `master` run typecheck, unit tests, production build, and the Electron smoke test.
- Pushing a `v*` tag builds macOS and Windows release artifacts.
- `v0.*` tags are prereleases; `v1.*` and later are stable releases.
- Only create or push release tags when the user explicitly asks.
