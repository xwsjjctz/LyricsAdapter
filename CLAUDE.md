# Claude Code

Read [AGENTS.md](AGENTS.md) for shared project instructions. It is the maintained
source for architecture, commands, validation, Git, and release constraints.

Testing follows AGENTS.md, which overrides any global test-first or coverage rule: do
not run tests unless the user asks, a PR into `master` is being created on GitHub, or
a release tag is about to be pushed.

For OpenSpec requests, read the relevant section of
[docs/agent-workflow.md](docs/agent-workflow.md). OpenSpec is optional for ordinary
repository work; local skills and commands are entry points, not extra approval gates.
