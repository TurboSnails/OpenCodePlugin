## 1. Detection logic (`src/hooks.ts`)

- [x] 1.1 Add a pure helper (e.g. `findRoutingViolation`) that takes a session's ordered messages (as returned by `client.session.messages`) and the set of compliant tool names (`{name}_start`/`{name}_reply` for every configured delegate) and returns whether the latest turn is a violation: find the last `role: "user"` message, collect every message after it, and check (a) none of them carry `info.error?.name === "MessageAbortedError"` (abort exemption, per design D1/Verified Findings) and (b) none of their parts is a `ToolPart` whose `tool` is in the compliant set. No tool call and no abort error ⇒ violation.
- [x] 1.2 Add `makeSessionIdle(config: CliDispatchConfig, client: OpencodeClient)` (or similar name/shape matching the existing `make*` hook factories in this file) implementing the `event` hook body: on `event.type === "session.idle"`, short-circuit if `!getActiveDelegate(sessionID)`; otherwise call `client.session.messages`, run the helper from 1.1, and on violation call `clearActiveDelegate(sessionID)` followed by `client.session.prompt({ path: { id: sessionID }, body: { noReply: true, parts: [{ type: "text", synthetic: true, text: <notice> }] } })`.
- [x] 1.3 Word the notice text: state that sticky delegation was disconnected because the model answered directly, and name the exact `/<delegate-name>` command to resume (resolve the Open Question in design.md — confirm wording with the user before finalizing).

## 2. Wiring (`src/index.ts`)

- [x] 2.1 Register the new hook as `"event": makeSessionIdle(config, input.client)` in the `Hooks` object returned by `createCliDispatchPlugin`, using the `client` field already available on `PluginInput` (currently unused).
- [x] 2.2 Confirm the degraded-config path (`catch` block, `config = { delegates: {} }`) either skips registering the hook or safely no-ops (empty compliant-tool set means every turn with an active delegation — which can't exist without delegates — would be flagged; verify this can't actually happen given delegates is empty).

## 3. Unit tests (`src/__tests__/hooks.test.ts` or a new `session-idle.test.ts`)

- [x] 3.1 Test: no active delegation for the session ⇒ handler returns without calling the (faked) `client` at all.
- [x] 3.2 Test: active delegation, last-message-after-user contains a `{name}_reply` tool part ⇒ compliant, delegation stays active, no notice posted.
- [x] 3.3 Test: active delegation, turn spans two assistant messages (tool-call message + trailing text message, per Verified Findings) ⇒ still compliant because the tool call is in the *first* assistant message, not just the last.
- [x] 3.4 Test: active delegation, model's turn is plain text with no tool call ⇒ violation: `clearActiveDelegate` called, `client.session.prompt` called with `noReply: true` and a synthetic notice part.
- [x] 3.5 Test: active delegation, model calls a *different* configured delegate's `{name}_start` (delegate-switch case) ⇒ compliant, not a violation (design D3).
- [x] 3.6 Test: active delegation, assistant message has `info.error.name === "MessageAbortedError"` ⇒ not a violation, delegation stays active, no notice posted (abort exemption).
- [x] 3.7 Test: `event` input for an unrelated event type (e.g. `session.status`) ⇒ handler ignores it without calling `client.session.messages`.

## 4. Spec and docs sync

- [x] 4.1 After implementation and tests pass, archive-eligible: confirm `openspec/changes/sticky-routing-violation-guard/specs/cli-dispatch/spec.md`'s delta still matches the shipped behavior exactly (scenario wording, tool-name coverage, abort exemption).
- [x] 4.2 Update `docs/configuration.md`'s "Known limitations" section: replace the "this case is permanent and undetectable" framing with a description of the disconnect-on-violation behavior, keeping the honest caveat that detection is always one turn late and cannot prevent the misleading answer from being shown.
- [x] 4.3 Update `README.md`'s feature list / how-it-works table if it enumerates hooks by name (currently lists `experimental.chat.system.transform`, `chat.message`, `command.execute.before` — add the new `event` hook).

## 5. Verification

- [x] 5.1 `bun test` passes with the new tests included.
- [x] 5.2 `tsc --noEmit` clean.
- [x] 5.3 Manual smoke test against a real `opencode serve` instance (same method used to validate this design): start a delegation, force a non-compliant plain-text turn, confirm the delegation clears and the notice appears without a spurious extra model turn.
