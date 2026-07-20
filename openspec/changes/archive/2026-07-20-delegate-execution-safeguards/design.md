## Context

Delegates run as executor subprocesses: the plugin spawns `claude`/`codex` with args from `cli-dispatch.config.json` and they edit the workspace directly. Two incidents motivated this change:

1. A config regression (new config used `--permission-mode dontAsk` / `sandbox_mode=read-only` while the old hardcoded args used `bypassPermissions` / `workspace-write`) silently made every delegate read-only. No test guarded the behavior contract "delegates can write", so it was only caught by users at runtime.
2. When a delegate edits files, the tool result is only the delegate's final text. The host conversation has no visibility into which files changed unless the user manually runs `git diff`.

Current architecture: `run-delegate.ts` spawns via `Bun.spawn` (cwd inherited from opencode), `delegate-tools.ts` wraps runs in `*_start`/`*_reply` tools, `src/index.ts` generates tools per configured delegate.

## Goals / Non-Goals

**Goals:**

- On-demand health check per delegate that proves write capability using the delegate's real spawn args
- Working-tree change summary appended to delegation tool results
- Documentation of delegate permission semantics (what the flags mean; permissions bake in at spawn time)

**Non-Goals:**

- Coupling delegate permission mode to the host's plan/permission mode (deferred — adds coupling, unclear payoff)
- "Advisor mode" (delegate proposes, host applies) — contradicts the sticky-executor design
- Automatic health check at plugin startup (too slow, costs tokens, needs auth; on-demand only)
- Verifying semantic correctness of delegate edits (tests/review remain the user's job)

## Decisions

### D1: Health check as a per-delegate `*_check` tool

For each configured delegate, generate a third tool `{name}_check` alongside `{name}_start`/`*_reply`. Consistent with the existing dynamic tool generation; invocable on demand by the user or the agent ("is claude able to write?").

The check:
1. Create a fresh temp directory (`mkdtemp`)
2. Spawn the delegate with its configured `startArgs`, prompt = a minimal write instruction (e.g. "Create a file named `healthcheck.txt` containing the word ok, then stop."), **cwd = temp dir**
3. After exit, scan the temp dir for any newly created file
4. Report pass/fail; on fail, include stderr excerpt and a hint that the delegate's permission/sandbox flags may be read-only, plus the config file location

Scanning for *any* new file (not an exact filename) tolerates delegates that interpret the instruction loosely.

Alternatives considered:
- **One-shot script instead of a tool** — harder to discover; the tool surfaces naturally in the agent's toolbox. Rejected.
- **Automatic check on plugin init** — every startup would spawn N CLIs (slow, spends tokens, needs network/auth). Rejected; on-demand only.

### D2: Extend `SpawnFn` with `cwd` and add a run timeout

Health check needs to spawn into a temp dir, so `SpawnFn` gains an optional `cwd`. A hung delegate must not hang the check: `runDelegate` gains an optional `timeoutMs` that kills the child and rejects. Both are additive; existing callers unaffected.

### D3: Diff summary via porcelain snapshots in `delegate-tools`

Around each `run()` call in `*_start`/`*_reply`:

1. Before: capture `git status --porcelain` (guarded — if cwd is not a git repo, skip entirely)
2. After the run: capture again; if identical, append nothing
3. If different: append a fenced section to the tool result: `git diff --stat` output (tracked changes) plus names of new untracked files, capped at ~50 lines with a truncation note

Why in `delegate-tools` not `run-delegate`: git awareness is a presentation concern of the tool layer; `run-delegate` stays a pure subprocess runner. Why snapshots instead of only post-hoc `git diff --stat`: post-hoc alone can't distinguish "changed during this run" from "was already dirty", and misses untracked new files.

Alternatives considered:
- **Full `git diff` content** — too large for tool results; `--stat` + filenames is the right granularity. Rejected.
- **Watching the filesystem during the run** — more precise attribution, far more complexity. Rejected.

### D4: Documentation lives in package README

New "Delegate permissions" section: what `dontAsk`/`acceptEdits`/`bypassPermissions` (claude) and `sandbox_mode` (codex) mean; that delegates are expected to be configured writable; that permissions are baked into a delegate session at spawn time, so config edits require exiting (`/opencode`) and restarting the delegation to take effect.

## Risks / Trade-offs

- [Health check costs a real CLI spawn (tokens, latency, requires auth)] → On-demand tool only, never automatic; check prompt kept trivial to minimize token spend
- [Delegate may not follow the write instruction exactly] → Scan temp dir for any new file rather than asserting an exact filename; still report fail-open details (stdout excerpt) when nothing appears
- [Dirty working tree before delegation makes attribution fuzzy] → Porcelain before/after snapshot delta, not absolute state; summary labeled "changed during this run"
- [Huge diffs bloat the tool result] → Cap summary at ~50 lines with truncation note
- [Git absent or not a repo] → Guard with try/catch; silently omit summary
- [Timeout kill may leave delegate-side orphan state] → Health check uses a fresh session each time (no resume), so no external id is worth preserving
