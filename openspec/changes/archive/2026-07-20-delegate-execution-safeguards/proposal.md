## Why

Delegates run as executor subprocesses (pattern B), but two safeguards are missing: (1) nothing verifies a configured delegate can actually write files — a config regression (`bypassPermissions` → `dontAsk`, `workspace-write` → `read-only`) silently made all delegates read-only and was only discovered by users at runtime; (2) after a delegate edits files, opencode only sees a text reply — which files changed is invisible unless the user manually runs `git diff`.

## What Changes

- Add a `checkDelegate(cfg)` health check that spawns the delegate with a trivial write instruction in a temp directory and reports whether the file was created — catches permission-mode config regressions before users hit them
- Append a `git diff --stat` summary to `*_start`/`*_reply` tool results when the working tree changed during the run, so delegate work is visible to the host conversation
- Document permission semantics: what each delegate CLI's sandbox/permission flags mean, that permissions are baked in at spawn time (config changes require restarting the delegate session), and the expectation that delegates are configured with write capability

## Capabilities

### New Capabilities
- `delegate-health-check`: On-demand verification that a configured delegate can write files, exercising its real spawn args against a temp directory

### Modified Capabilities
- `cli-dispatch`: Tool results SHALL include a working-tree change summary (`git diff --stat`) when a delegation run modified files; docs SHALL state delegate permission semantics and spawn-time baking

## Impact

- `src/run-delegate.ts` — capture pre/post working-tree state around subprocess run
- `src/delegate-tools.ts` — append diff summary to tool results
- New `src/health-check.ts` — `checkDelegate(cfg)` implementation
- `src/index.ts` — export health check
- New tests for health check and diff summary
- README or docs section on permission semantics
