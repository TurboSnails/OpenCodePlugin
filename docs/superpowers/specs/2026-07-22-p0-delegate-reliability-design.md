# P0 Delegate Reliability Design

Date: 2026-07-22
Status: Approved for planning

## Context

The current delegation layer makes three promises it cannot keep: sticky routing is specified as guaranteed while it depends on model compliance; permission defaults fail open into powerful delegates; and process/session lifecycle handling lets delegates keep running after the host believes they stopped. This change is a reliability package only. It does not build the broker daemon and does not change the product shape beyond making failure modes explicit, safe, and testable.

## Goals

- Stop claiming guaranteed sticky routing. Keep sticky mode, but specify it as best-effort and make silent host fallback detectable in documentation and errors.
- Make permission and policy behavior fail safe by default.
- Close the direct tool-call bypass around the model allow-list.
- Prevent prompt/externalId argv injection through missing `--` separators and unvalidated session ids.
- Guarantee that timeout/cancellation terminates the whole delegate process tree and that a crashed delegate is not reported as success.
- Remove duplicated delegate-turn orchestration so reliability fixes are implemented once.

## Non-Goals

- No broker daemon, worktree isolation, audit log, or ACP migration in this package.
- No attempt to force a model to call a tool when it chooses to answer directly. OpenCode and Claude Code do not expose a hook for that case.
- No Codex-as-host work.
- No npm publishing or install-flow redesign.

## Decisions

### D1: Sticky routing is best-effort; explicit delegation is the reliable path

Update the cli-dispatch spec and README so sticky follow-ups are "best-effort routing", not a SHALL guarantee. A `/<delegate> <message>` command remains the reliable way to send a message. Sticky follow-ups may still route through `{name}_reply`, but docs must state that a model answering directly is outside the plugin's control. The generated routing rule keeps its current legitimate wording; no adversarial wording is introduced.

Rationale: both hosts lack a deterministic interception point for a plain-text assistant answer. A reliability package must not document a guarantee the architecture cannot enforce.

### D2: Permission defaults fail safe

Change built-in delegate presets to the least powerful useful defaults:

- `claude`: `--permission-mode acceptEdits` instead of `bypassPermissions`.
- `codex`: keep `sandbox_mode=workspace-write`.
- `opencode`: no permission-escalating flags; document that OpenCode's own permission mode applies.

When no config file exists, the plugin may still use built-in defaults, but it logs a loud warning that safe built-in defaults are in use and tells the user where to place `cli-dispatch.config.json`. A config file that explicitly requests `bypassPermissions` remains allowed, but README must label it as an opt-in escalation.

### D3: The model gate also covers direct tool calls

Extend the existing verified-models check to the tool-invocation path:

- OpenCode: `tool.execute.before` evaluates `{name}_start` and `{name}_reply` against the tracked session model when `verifiedModels` is non-empty.
- Claude Code adapter: `PreToolUse` performs the same check using the transcript-derived current model.

If `verifiedModels` is configured and the current model is known and not allowed, the call is rejected before the delegate spawns. If the model is unknown, the start path fails open for the first message only, as today; direct tool calls with unknown model also fail open, and the docs state that the gate is a guardrail against known-bad models, not a sandbox.

### D4: Argv construction is validated against flag injection

`validateDelegates` rejects a delegate whose `startArgs` or `replyArgs` contains `{prompt}` unless a literal `--` token appears before the placeholder-containing argument. The same rule applies to `{externalId}` when it is substituted into a position that could be parsed as a flag. Built-in configs are updated to satisfy the rule. For the adapter's `opencode` delegate, implementation must first live-check that `opencode run` accepts `--` before the prompt; if it does not, the built-in `opencode` delegate is marked invalid in that environment instead of shipping an unverified escape.

Parser-reported `externalId` values are validated before storage with the conservative pattern `^[A-Za-z0-9_-]{8,128}$`. A reported id outside that pattern is ignored, and the run falls back to the client-generated session id when one exists.

### D5: Delegate runs terminate the whole process tree and never mask crashes

`runDelegate` spawns each delegate in its own process group on POSIX and kills the group on timeout/cancellation; on Windows it uses tree termination. The implementation waits for process exit, not merely for stdout/stderr EOF, so grandchildren holding pipes open cannot hang a timed-out run forever.

A non-zero exit is a failure even when final text was produced. The returned error includes the exit code and a capped stderr excerpt. stdout, stderr, and individual line buffers are capped; exceeding a cap fails the run with a clear "delegate produced too much output" error rather than growing memory without bound.

### D6: One delegate-turn module behind one store interface

Extract the duplicated start/reply orchestration from `src/delegate-tools.ts` and `src/claude-code-adapter/delegate-tools.ts` into a host-agnostic `delegate-turn` module. It accepts the delegate config, prompt, session key, store, home-command name, progress callback, optional abort signal, and working directory. Hosts keep only tool-registration adapters.

Introduce a `DelegateStore` interface with active-delegate get/set/clear and an atomic `setActiveDelegateIfLatest(sessionKey, delegate, externalId, sequence)` operation. The OpenCode memory store and the Claude Code file store both implement it. This closes the check-then-set race by interface rather than by adjacent statements.

Move `GENERATED_MARKER` to a shared constant and require generated commands to declare their target delegate structurally in frontmatter. OpenCode delegate-command detection uses that declaration instead of substring matching for `{name}_start` in rendered command text.

### D7: Session state survives restarts without pretending to be a broker

Persist active delegation state in a small state file for both hosts:

- OpenCode: active delegations are written to a small state file keyed by opencode session id. The in-memory store hydrates a session from that file on first access for that session; if hydration finds no fresh entry, the next delegate reply fails with an explicit "delegation state was lost; start again or exit" message instead of silently answering as the host.
- Claude Code adapter: keep the file-backed store, create its directory with mode `0700`, write files with mode `0600`, and ignore entries older than 24 hours.

This is intentionally minimal recovery, not a daemon. It removes the silent wrong-speaker failure without adding a broker.

## Architecture

```text
OpenCode tool adapter ─┐
                       ├─ delegate-turn ── runDelegate ── delegate CLI process tree
Claude MCP adapter  ──┘        │
                               ├─ DelegateStore (memory | file)
                               ├─ worktree-summary
                               └─ policy checks (model gate, marker, argv validation)
```

The delegate-turn module owns sequencing, argv resolution, process lifecycle, session-id capture and validation, change summary, and error wording. Host adapters translate their native tool shapes into that single call.

## Error Handling

- Config invalid: OpenCode keeps the `cli_dispatch_status` diagnostic tool; Claude Code hook scripts catch config errors and exit 2 with the same actionable text.
- Delegate spawn failure/non-zero exit/timeout/cancellation/output-cap exceeded: preserve active state, return a distinct message for each failure class, and include the home command.
- Lost/restored state: restored delegations are announced once per session; unrecoverable state produces an explicit start-again message.
- Invalid reported externalId: ignore it and use the client-generated id when available; otherwise fail the run before registering state.

## Testing

- Unit: argv validation accepts built-ins and rejects missing `--`; externalId pattern accepts `ses_...`, UUIDs, and rejects flag-shaped ids; model gate covers direct tool calls; store `setActiveDelegateIfLatest` cannot be overwritten by an older sequence; output caps fail deterministically.
- Integration: fake delegate emits final text then exits 1 and is reported as failure; a delegate that forks a grandchild is fully killed on timeout; lost-state recovery announces itself; Claude file store ignores stale entries and uses restrictive file modes.
- Live: `/cc hello` sticky follow-up still works on a verified model; direct `{name}_start` is blocked for an unverified model; `claude_check`/`codex_check` pass with the new safe defaults in an isolated directory.

## Migration

Existing explicit `bypassPermissions` configs continue to work. Built-in defaults become safer, so users relying on the implicit claude default must opt into `bypassPermissions` in `cli-dispatch.config.json`. The spec and README are updated in the same change, and the unarchived `claude-code-host-adapter` change is archived after its spec deltas are merged into `openspec/specs/`.
