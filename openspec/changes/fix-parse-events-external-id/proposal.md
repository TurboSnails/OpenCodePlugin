## Why

`parseClaudeLine` in `src/parse-events.ts` never returns `externalId`, unlike `parseCodexLine`, which extracts one from the `thread.started` event. Because `makeStartTool` (`src/delegate-tools.ts:83`) only calls `setActiveDelegate` when `result.externalId` is truthy, a `claude_start` call never registers an active session. Every subsequent `claude_reply` call then hits `getActiveDelegate` returning nothing and throws `"No active claude session for this conversation."` — regardless of permissions or CLI configuration. Sticky multi-turn routing for claude is effectively broken today.

## What Changes

- `parseClaudeLine` (and/or `makeStartTool`) is updated so that starting a claude delegation reliably yields an `externalId`, restoring the ability to persist and reuse the claude session id across turns.
- No change to `parseCodexLine`, which already works correctly.

## Capabilities

### New Capabilities
(none)

### Modified Capabilities
- `cli-dispatch`: the "Session state scoped per opencode session" and sticky-routing requirements assume a delegate's session id is captured on start; for the `claude` delegate this currently never happens, so the existing spec behavior is not met and needs a corrected implementation (no wording change expected, this is a conformance fix).

## Impact

- `src/parse-events.ts` (`parseClaudeLine`)
- `src/delegate-tools.ts` (`makeStartTool`, `makeReplyTool` — may need to also pass the known `sessionId` through, depending on chosen fix)
- `src/run-delegate.ts` (return-value plumbing, no expected changes)
- Tests: `src/__tests__/parse-events.test.ts`, `src/__tests__/session-store.test.ts`, and any delegate-tools tests covering `claude_start`/`claude_reply`
- No changes to `codex` or `raw` delegate behavior.
