## 1. Fix externalId capture for claude_start

- [ ] 1.1 In `src/delegate-tools.ts`, hoist the generated `sessionId` in `makeStartTool` to a named variable (instead of an inline `crypto.randomUUID()` call) so it can be reused after `run()` returns
- [ ] 1.2 In `makeStartTool`, compute `const externalId = result.externalId ?? sessionId` and use it for the `setActiveDelegate` call, instead of relying solely on `result.externalId`
- [ ] 1.3 Confirm no change is needed in `makeReplyTool` (it already reads `active.externalId` from the session store)

## 2. Tests

- [ ] 2.1 Add/update a test for `claude_start` (in the `src/` delegate-tools test suite) asserting that `setActiveDelegate` is called with the same session id that was passed via `--session-id` in `startArgs`, even though `parseClaudeLine` returns no `externalId`
- [ ] 2.2 Add/update a test asserting that a `claude_reply` call following `claude_start` succeeds (does not throw "No active claude session") using a fake/stub `runDelegate`
- [ ] 2.3 Verify existing `src/__tests__/parse-events.test.ts` and `src/__tests__/session-store.test.ts` still pass unchanged (parser behavior itself is not modified)

## 3. Verification

- [ ] 3.1 Run the full test suite (`bun test` or project's configured test runner) and confirm all tests pass
- [ ] 3.2 Manually or via test confirm `codex_start`/`codex_reply` behavior is unaffected by this change
