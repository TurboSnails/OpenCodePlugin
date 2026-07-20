## Context

`src/config.ts` already generates the claude session id client-side and passes it to the CLI explicitly via `--session-id {sessionId}` in `startArgs`. Replies use `--resume {externalId}`. So, unlike codex (which assigns its own thread id and reports it back via a `thread.started` event that we must parse), the claude session id is already known to `makeStartTool` *before* the subprocess is even spawned — it's the `sessionId` passed to `resolveArgs`.

Today `makeStartTool` (`src/delegate-tools.ts:63-88`) discards that generated id and instead waits for `result.externalId` to come back from `runDelegate`/`parseClaudeLine`, which never populates it. This is why `claude_start` never calls `setActiveDelegate`.

Notably, an older/parallel implementation at `.opencode/lib/cli-dispatch/delegate-tools.ts` already handles this correctly for claude: its `start()` closure returns `{ args: buildClaudeStartArgs(sessionId, prompt), externalId: sessionId }` directly, without relying on the parser at all.

## Goals / Non-Goals

**Goals:**
- Make `claude_start` reliably register an active delegate session so `claude_reply` works.
- Keep `codex`'s existing (working) behavior unchanged.
- Keep the fix generic across the config-driven delegate system (`config-driven-delegates` spec) rather than hardcoding claude-specific logic where avoidable.

**Non-Goals:**
- Rewriting `run-delegate.ts`'s streaming/progress-reporting logic.
- Changing the CLI flags or config schema.

## Decisions

**Decision: pass the known `sessionId` through as the externalId for `makeStartTool`, rather than relying solely on parsed stdout.**

Rationale: for claude, the externalId is a *client-generated* id we already hold (`crypto.randomUUID()` at `src/delegate-tools.ts:66`), not something the CLI assigns and reports back. Parsing stdout for it is solving a problem that doesn't exist for this delegate — codex's `thread.started` extraction exists because codex assigns its own thread id server/CLI-side, which is a genuinely different situation.

Concretely: `makeStartTool` should track the `sessionId` it generated and fall back to it when `result.externalId` is absent, e.g.:
```ts
const sessionId = crypto.randomUUID()
const resolvedArgs = resolveArgs(cfg.startArgs, { prompt: args.prompt, sessionId })
...
const externalId = result.externalId ?? sessionId
if (externalId) setActiveDelegate(context.sessionID, name, externalId)
```
This keeps `parseClaudeLine` untouched (it genuinely has nothing useful to extract for this purpose) and mirrors the working pattern already present in `.opencode/lib/cli-dispatch/delegate-tools.ts`.

**Alternative considered: teach `parseClaudeLine` to extract a session id from claude's stream-json output** (e.g. the `system`/`init` event's `session_id` field, mirroring `parseCodexLine`'s `thread.started` handling).

Rejected as the primary fix because:
- It depends on an undocumented/implementation-detail field of claude's stream-json output that isn't currently asserted anywhere in this codebase or its tests.
- It's unnecessary work: we already know the id before the process even starts.
- It only produces a value on `claude_start`'s first line of output, adding a timing dependency for no benefit over the value we already hold.

It may still be worth doing as defense-in-depth later (e.g. to detect a mismatch if claude ever ignores `--session-id`), but that's out of scope for this fix.

**Decision: only change `makeStartTool`, not `makeReplyTool`.**

`makeReplyTool` already receives `active.externalId` from the session store and passes it through; it does not need the parsed externalId at all, so no change is needed there for the claude case. `result.externalId` from `runDelegate` remains unused for `claude_reply`'s own externalId bookkeeping (there is no session to *re*-register once already active), consistent with today's code.

## Risks / Trade-offs

- [Risk] If claude's actual CLI behavior ever fails to honor `--session-id` (e.g., silently generates its own), `--resume {sessionId}` on the next reply would fail. → Not observed in current usage; out of scope to guard against here. Could be revisited via the stdout-parsing alternative above if it becomes a real failure mode.
- [Trade-off] The fix lives in `makeStartTool`, which is slightly less "generic" than fixing it purely inside the parser layer. Trade-off accepted because it correctly reflects that codex and claude get their externalId from fundamentally different sources (CLI-reported vs. client-generated).

## Open Questions

- Should `DelegateConfig`/`config-driven-delegates` gain an explicit flag (e.g. `externalIdSource: "client-generated" | "cli-reported"`) so future delegates don't need a code-level decision each time? Left for the `config-driven-delegates` capability to decide if/when a third delegate with different semantics is added; not needed for this bugfix.
