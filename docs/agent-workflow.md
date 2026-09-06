# Agent workflow

Use [AGENTS.md](../AGENTS.md) for project constraints. This file is the shared source
for local OpenSpec skills and command wrappers; read only the relevant operation.
OpenSpec is optional unless the user requests it or the task continues an existing
OpenSpec change. It is not a prerequisite for ordinary fixes.

## Shared decisions

Infer the target and desired outcome from the conversation. For OpenSpec work, use
`openspec list --json` if needed to resolve active changes. Select an explicit or
clearly contextual target; a sole active change is a default only if it matches the
request. Ask when multiple plausible targets remain or no usable task is given.

Use the installed CLI's status and instructions to discover schemas, dependencies,
and file paths. Resolve ordinary errors and in-scope artifact updates autonomously.
If the CLI is missing, continue useful investigation; report the limitation only for
operations that require it. Do not depend on a named question tool, subagent tool, or
skill that the environment does not provide. Use available equivalents.

User corrections refine the current task; a question or progress request does not
cancel it. Stop dependent work only for a real authorization/decision blocker or an
explicit pause. Report the specific blocker and finish independent authorized work.

## Explore

Investigate relevant code and artifacts, compare options, and explain evidence and
tradeoffs. A request only to explore does not authorize implementing a feature.
If the user then asks for implementation, transition directly into that authorized
work; no special exit command or extra proposal is required. Update artifacts when
that is part of the request or already authorized. Use diagrams only if they clarify.

## Propose

Derive a descriptive kebab-case change name from the request. Reuse an existing
matching change when the intent is continuation; avoid overwriting a different change
with the same name. Create a new change with `openspec new change "<name>"` as needed.

Read `openspec status --change "<name>" --json`, then generate required artifacts in
dependency order using `openspec instructions <artifact-id> --change "<name>" --json`.
Read relevant dependencies, follow the returned template/output path, and apply
context/rules without copying instruction blocks into the artifact. Refresh status
as dependencies become ready; complete the schema's `applyRequires` artifacts.

State reasonable assumptions and ask only for material missing decisions. Verify the
written artifacts and report readiness. If implementation was also requested, continue
to Apply; otherwise deliver the proposal without treating it as implementation approval.

## Apply

Read `openspec status --change "<name>" --json` and
`openspec instructions apply --change "<name>" --json`. Read returned `contextFiles`
and pending tasks. Repair missing artifacts from clear, authorized requirements; ask
only when their content requires a material decision the user has not made.

Implement pending tasks, updating artifacts for justified in-scope design changes.
Verify affected behavior using AGENTS.md and mark a checkbox complete only when its
acceptance conditions are met. Fix recoverable errors and continue. Do not restart
completed tasks merely because the workflow is invoked again. For `all_done`, verify
the recorded status and report completion; archive only if that is also authorized.

## Archive

An archive request authorizes moving the selected change locally. Check CLI status,
task completion, and any delta specs against `openspec/specs/` before moving it.
Report incomplete work accurately. Ask once before archiving unfinished work only
when the user has not already authorized doing so; do not mark unfinished tasks done.

Assess spec synchronization separately from the move. If the request or existing
authorization includes syncing/finalizing specs, apply clear deltas while preserving
unrelated requirements. Otherwise show the concrete pending delta summary and ask
whether to sync or archive without syncing. Already-synced specs need no confirmation.
Use an available sync skill or the CLI schema's delta semantics; do not require an
uninstalled `openspec-sync-specs` skill. If sync semantics are unclear, pause that
mutation and explain the exact ambiguity.

Move the entire change directory, including `.openspec.yaml`, to
`openspec/changes/archive/YYYY-MM-DD-<name>/` using the current date. If the destination
exists, inspect whether the operation already completed; never overwrite another
archive. Use a non-conflicting suffix if the layout supports it, otherwise ask for the
destination. Report the actual archive path, sync state, and any remaining work.
