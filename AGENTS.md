# LyricsAdapter agent guidance

## Scope and autonomy

- Complete the requested work, including appropriate verification, within the user's
  authorized scope. Reuse prior authorization; resolve routine implementation choices
  and recoverable errors without a new approval round.
- User instructions take precedence over repository and skill guidelines, subject to
  higher-priority instructions and execution permissions. Ask only when a missing
  decision materially affects scope, data safety, or an action not already authorized.
  Continue independent work while that decision is pending.
- Preserve unrelated working-tree changes. Before changing feature behavior, briefly
  identify the domain, state read/write scope, and likely files; this is a working
  hypothesis to refine from evidence, not an approval step for every edit.
- If a local rule actually blocks progress, link the file and quote the applicable
  rule; distinguish an explicit requirement from your interpretation.
- Use skills and OpenSpec when relevant to the request. Read only needed references.
  See [agent workflow](docs/agent-workflow.md) for OpenSpec operations.

## Navigation and commands

When `.codegraph/` exists, try CodeGraph first for symbol and call-path questions:
`codegraph explore "<question>"` or `codegraph node <symbol-or-file>` (or matching MCP
tools). Use `rg` and direct reads for documentation, exact text, or when the index is
unavailable, stale, or unhelpful. Do not create an index just for this preference.

Use the Node version supported by `package.json`; npm scripts are the command source
of truth. Common entry points:

```bash
npm run dev                   # Browser-only Vite
npm run electron:dev          # Normal desktop development
npm run electron:debug        # Renderer CDP :9222; main inspector :9229 (loopback)
npm run typecheck             # Application TypeScript
npm run typecheck:test        # Unit-test TypeScript
npm run typecheck:e2e         # Playwright/Electron TypeScript
npm test -- <test-path>       # Focused Vitest tests; omit path for full suite
npm run check                # All typechecks, unit tests, production build
npm run test:e2e -- <spec>    # Build and run selected real-Electron tests
npm run test:e2e:run -- <spec> # Reuse a current build for selected Electron tests
npm run electron:build       # Package current platform; :mac/:win/:linux also exist
```

Choose checks for the affected behavior. Documentation-only edits need link, command,
and consistency checks; UI changes need relevant visual checks; IPC, preload,
persistence, or native changes need corresponding integration/platform checks.
Before delivering a code PR, run `npm run check` and affected Electron tests where
the environment supports them. CI retains its full platform matrix in
`.github/workflows/pr-check.yml`. Repeat or broaden checks only for new changes,
failures, or unresolved risks; report checks that could not run.

## Architecture and ownership

LyricsAdapter is an Electron + React 18 + Vite music player. `@/` maps to `src/`.

- `electron/` owns windows, IPC, file I/O, protocols, native integrations and proxies.
  `electron/preload.ts` exposes the typed bridge. Renderer application code uses
  `src/services/desktopAdapter.ts` (`getDesktopAPI`, `getDesktopAPIAsync`, `isDesktop`);
  direct `window.electron` access belongs to the bridge or tests verifying it.
- Keep `App.tsx` and extracted composition roots focused on wiring. Put domain behavior
  in controllers, hooks, or services according to ownership, not file-length limits.
- UI emits intent through callbacks. The player controller owns playback mutations;
  the library controller owns imports, removals, metadata changes and slot mutations.
  UI and online providers do not bypass those owners or call `updateSlot` directly.
  Providers fetch/normalize data and resolve streams/downloads for the controllers.
- `useLibrarySlots.ts` maintains `local`, `cloud`, `online`, and play-only `playlist`
  contexts. Preserve per-slot tracks, selection, time, volume, mode, filters and scroll
  state; switching contexts restores state paused unless the requested feature changes
  that contract through the player controller.
- Preserve path-based local/WebDAV track identity, lazy audio loading, and cached
  `cover://` covers. Persistence spans repositories and main-process stores; inspect
  the current storage path before changing serialization or migration behavior.
- Use the existing `music-tag-native` bridge for metadata, preserving legacy MP3
  `node-id3` behavior unless the task deliberately migrates it.
- Use the process-appropriate logger (`src/services/logger.ts` or `electron/logger.ts`)
  for application diagnostics. Window drag regions are defined in `TitleBar.tsx`.

## Debugging and Git

- Start a dev server or Electron when needed for the task. Normal development has no
  debug ports; CDP covers the renderer only. Read [DEBUGGING.md](DEBUGGING.md) for live
  debugging and isolated E2E data. Stop only processes this task started and no longer
  needs. Keep `.playwright-mcp/`, `.codegraph/` and build outputs untracked.
- Before committing on `master`, create a focused branch. Prefer `feature/`, `fix/`,
  `refactor/`, `docs/`, or `perf/` unless the user or host requires another prefix.
  Commit titles use a conventional prefix (`feat`, `fix`, `refactor`, `docs`, `chore`,
  `perf`, `ci`) and a concise Chinese summary, normally at most 72 characters; an
  optional body explains material changes. Explicit user format requests take priority.
- When pushing/PR delivery is requested or already authorized, push the focused branch
  with upstream tracking and use a PR for `master`. This convention is not itself a
  request to commit, push, or merge every local edit.
- Release tags require an explicit user request. Pushing `v*` triggers macOS/Windows
  release builds; `v0.*` is prerelease and `v1.*` onward is stable. Consult
  `.github/workflows/release.yml` when release work is requested.
