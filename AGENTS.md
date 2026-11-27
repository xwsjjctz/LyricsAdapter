# LyricsAdapter agent guidance

## Scope and autonomy

- Complete the requested work within the user's authorized scope. Verification by
  running tests follows the limits in [Navigation and commands](#navigation-and-commands). Reuse prior authorization; resolve routine implementation choices
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

## Orca orchestration

- When a complex task has at least two independent subtasks, the coordinating
  agent must automatically use the Orca `orchestration` skill to dispatch them.
  This is standing authorization to start the necessary workers within the task's
  scope. Handle simple tasks directly and honor a user request for a single agent.
- Follow the user's plan when provided, including assignments, dependencies, and
  acceptance criteria. Otherwise split the task by deliverable. Give each worker a
  self-contained brief with its goal, allowed files and commands, and what to report.
- Use Orca `orchestration worker-start` for workers. Default to local Codex workers
  with at most three active at once. Use the current worktree for read-only work
  and separate child worktrees when concurrent edits would conflict. Dispatch
  dependent work once its prerequisites are met.
- The coordinator reviews worker results, integrates authorized changes, and reports
  outcomes and blockers. Workers inherit the user's scope and this repository's
  test, build, and Git rules. Workers do not delegate recursively.

### Dependency audits

- When the user's task or plan calls for checking vulnerable or outdated dependencies
  or evaluating upgrades, the coordinator must automatically send a read-only
  `question` to the Orca bot `bot:依赖更新` via `orchestration send`. This is standing
  authorization to contact that bot for those audits.
- Include the repository, target branch or ref, and audit scope. Audit LyricsAdapter
  by default. Include LyricsAdapter-Android only when the user includes it in scope.
  Request a prioritized report with affected dependencies, evidence, and recommended
  upgrade versions. Instruct the bot to leave files, commits, and pull requests alone.
- Review the bot's Orca mailbox reply before starting work that depends on it.
  The coordinator is responsible for advancing the plan after the reply arrives.

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
npm run deps:check            # Dependency boundary rules (known violations baselined)
npm run typecheck             # Application TypeScript
npm run typecheck:test        # Unit-test TypeScript
npm run typecheck:e2e         # Playwright/Electron TypeScript
npm test -- <test-path>       # Focused Vitest tests; omit path for full suite
npm run check                # All typechecks, unit tests, production build
npm run test:e2e -- <spec>    # Build and run selected real-Electron tests
npm run test:e2e:run -- <spec> # Reuse a current build for selected Electron tests
npm run electron:build       # Package current platform; :mac/:win/:linux also exist
```

Do not run tests, typechecks or builds as routine verification of local edits. Run
them only in these cases:

- The user asks for them.
- Before creating a GitHub PR that merges into `master`: run `npm run check` and the
  affected Electron tests where the environment supports them.
- Before starting the release workflow: run the same checks.

Otherwise make the change, review it by reading the code, and say plainly in the
report that it was not run. In the cases above, choose checks for the affected
behavior: IPC, preload, persistence or native changes need the corresponding
integration/platform checks, and UI changes need relevant visual checks. CI retains
its full platform matrix in `.github/workflows/pr-check.yml`. Report checks that could
not run.

## Architecture and ownership

LyricsAdapter is an Electron + React 18 + Vite music player. `@/` maps to `src/`.

- `electron/` owns windows, IPC, file I/O, protocols, native integrations and proxies.
  `electron/preload.ts` exposes the typed bridge. Every IPC channel is declared once in
  `src/shared/ipcContract.ts`; the preload uses its `invoke`/`listen`/`send` helpers and the
  main process registers only through `electron/ipc/ipcMainTyped.ts`. Renderer application code uses
  `src/services/desktopAdapter.ts` (`getDesktopAPI`, `getDesktopAPIAsync`, `isDesktop`);
  direct `window.electron` access belongs to the bridge or tests verifying it.
- Keep `App.tsx` and extracted composition roots focused on wiring. Put domain behavior
  in controllers, hooks, or services according to ownership, not file-length limits.
- UI emits intent through callbacks. The player controller owns cross-slot selection,
  online/playlist play contexts and their lyrics; the library controller owns removals,
  reordering, metadata edits and adding finished downloads. UI and online providers do
  not bypass those owners or call `updateSlot` directly. Providers fetch/normalize data
  and resolve streams/downloads for the controllers.
- Slot state lives in the `src/stores/libraryState.ts` store; components read it with
  `useLibraryState(selector)`. `useLibrarySlots` defines the writers and the controllers
  use them. These existing flows also receive writers from `AppContent` and write
  directly: `useImport` (local import, cloud upload), `useLibraryCloudSync` (WebDAV
  scan results), `useOnlineMusicIntegration` (merging uploads into `cloud`),
  `useLibraryActions` (file reload), `useLibraryLoad` (startup restore) and
  `usePlayback` (duration, lazily loaded `audioUrl`, cached lyrics on the playing
  track). Do not add writers outside the controllers; components never write slots.
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
- Icon controls must not use HTML `title` attributes or native tooltips. Provide
  accessible names with `aria-label` in the renderer and `accessibilityLabel` in
  native code; show essential explanations in visible UI instead of hover text.

## Debugging and Git

- Start a dev server or Electron when needed for the task. Normal development has no
  debug ports; CDP covers the renderer only. Read [DEBUGGING.md](docs/DEBUGGING.md) for live
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
- Releases require an explicit user request. Bump `package.json` (and the lockfile),
  commit and push the branch, run the checks above, then start the release with
  `gh workflow run release.yml --ref <branch>`. Never push `v*` tags yourself: the
  workflow builds the branch head and GitHub creates `v<version>` only when the finished
  Release is published, so a failed build leaves no tag. `v0.*` and versions with a
  prerelease suffix are prereleases; `v1.*` onward is otherwise stable. Consult
  `.github/workflows/release.yml` when release work is requested.
