## Context

Sticky routing works by injecting a system-prompt instruction (`buildRoutingRule`, `src/routing-rule.ts`) telling the model to call `{name}_reply` instead of answering a follow-up directly. Nothing in OpenCode can force a tool call, so a model can always choose to answer in plain text instead. Today that failure is invisible: `session-store` keeps reporting the delegation as active, the routing rule keeps getting injected on the next turn, and the user has no way to tell — from inside the chat — that the previous turn never reached the delegate CLI. `docs/configuration.md` and `openspec/specs/cli-dispatch/spec.md` both document this as a permanent, accepted limitation ("no hook fires for a plain-text answer").

That statement was true for the four hooks the plugin currently registers: `chat.message`, `experimental.chat.system.transform`, `command.execute.before`, `tool.execute.before`. It does not account for two things confirmed present in `node_modules/@opencode-ai/plugin` and `node_modules/@opencode-ai/sdk` at the time of this design (plugin `1.18.3`):

- `Hooks["event"]`: `(input: { event: Event }) => Promise<void>`, where `Event` includes `EventSessionIdle` (`{ type: "session.idle", properties: { sessionID } }`), fired once the model's turn ends.
- `PluginInput.client: OpencodeClient`, available at plugin setup, with `client.session.messages({ path: { id } })` (fetch full message + parts history) and `client.session.prompt({ path: { id }, body: { noReply?: boolean, parts, ... } })`.

This design proposes wiring those together to detect (never prevent) a routing violation and disconnect the delegation instead of leaving it silently active.

## Verified Findings (2026-07-24)

The assumptions above were tested empirically against a real `opencode serve` instance (v1.18.4, `opencode/deepseek-v4-flash-free`), not just inferred from SDK type declarations. Test scripts and raw output are not part of this change (scratch, discarded after the run).

- **`client.session.prompt({ noReply: true, parts: [{ type: "text", synthetic: true, ... }] })` behaves as hoped.** The call returned in ~400ms (no model-call latency), inserted exactly one `role: "user"` message with the given text/`synthetic: true` part, and — confirmed by re-checking after an 8s wait — never triggered any assistant generation. `synthetic: true` round-trips onto the stored part, the same flag already used by `command.execute.before`'s existing notices.
- **`session.idle` fires reliably once, strictly after the turn's messages are fully persisted.** Subscribing to `client.event.subscribe()` and sending a real prompt showed the event ordering: `message.part.delta`(s) → final `message.part.updated` → `session.status: busy→idle` → `session.idle`. By the time `session.idle` arrives, `client.session.messages` already returns the complete assistant output for that turn — no polling/retry needed.
- **Correction to the detection logic: a single turn can produce more than one assistant message.** Prompting the model to call the `bash` tool produced *two* assistant messages for one user turn — the first containing the tool-call part (`{ type: "tool", tool: "bash", state: { status: "completed" } }`), the second containing the model's follow-up text after the tool result. Checking only "the most recent assistant message" would have missed the tool call entirely. The correct grouping is: all assistant messages that appear *after* the latest user message in `client.session.messages`' chronologically-ordered result, not just the last one. This is reflected in D2 below.
- **`session.idle` fires after an aborted turn too, and carries a clean signal to distinguish it.** Sending a prompt, waiting 3s, then calling `client.session.abort({ path: { id } })` produced `session.idle` almost immediately (~200ms after the abort call). The resulting assistant message had **`info.error: { name: "MessageAbortedError", data: { message: "Aborted" } }`** and no tool-call part (the turn was interrupted before it could call anything). This closes the last Open Question: the handler can check for `info.error?.name === "MessageAbortedError"` on the post-user-message assistant message(s) and skip the violation check entirely when present, so a user-initiated interruption is never misattributed as model non-compliance. Reflected in D1 below.

## Goals / Non-Goals

**Goals:**
- Detect, after the fact, when a model's turn during an active delegation contains no tool call to any configured delegate's `{name}_start`/`{name}_reply`.
- On detection, clear the active delegation and leave a visible, non-generating notice in the transcript explaining why.
- Keep the implementation surface minimal: no new session-store fields, no violation-counting/streak state, no retry logic.

**Non-Goals:**
- Forcing or guaranteeing tool-call compliance — not possible with the available hooks.
- Auto-retrying or auto-correcting the violating turn (considered and rejected — see Decisions).
- Replacing or changing `verifiedModels`, which remains the preventive, start-time half of the reliability story.
- Detecting violations *within* a turn (e.g., partial compliance, mixed text+tool-call turns) beyond the single check described below.

## Decisions

### D1: Disconnect-on-violation (option C), not warn-only (A) or auto-retry (B)
Three response strengths were considered once a violation is detected:
- **(A) Warn only**: leave a notice but keep the delegation marked active. Rejected — the delegation is already unreliable for this session; leaving it "active" invites the same silent failure on the very next turn.
- **(B) Auto-retry/auto-correct**: use `client.session.prompt` to re-issue the user's message toward the delegate tool programmatically. Rejected as the largest implementation surface for the least certainty — it requires guessing at model intent, risks double-executing a delegate call if the model's plain-text answer was actually an acceptable response to a meta-question about the delegation itself, and re-introduces exactly the "force compliance" problem this design explicitly avoids.
- **(C) Disconnect and notify (chosen)**: clear the delegation (`clearActiveDelegate`, already exists) and post a visible notice. Smallest surface — reuses existing state-clearing code, adds no new session-store fields, and matches the project's existing philosophy (seen in `verifiedModels`) of "block/stop known-bad situations, don't try to force good ones."

No violation-count threshold: the first detected violation disconnects immediately. A grace/streak counter was considered (e.g., disconnect only after N consecutive violations) but adds new per-session state for a benefit that cuts against the goal of transparency — a false negative (staying "active" through a second silent miss) is worse than a false positive (disconnecting on a one-off hiccup, which just means the user re-issues `/<delegate-name>`, already the documented recovery path).

One explicit exception to "first violation disconnects immediately": a user-initiated abort must not count as a violation (see Verified Findings — `info.error.name === "MessageAbortedError"`). The handler skips the check entirely when the post-user-message assistant message(s) carry that error, leaving the delegation active exactly as if `session.idle` had never fired for that turn.

### D2: Detect via `session.idle` + `client.session.messages`, not `experimental.text.complete`
`experimental.text.complete` fires per-text-part and can rewrite that part's text before it's shown — theoretically allowing prevention rather than after-the-fact detection. Rejected for this design: a model may legitimately emit explanatory text *and* a tool call in the same turn (preamble before delegating), and a single part's completion doesn't reveal whether a later tool-call part is coming in the same turn. Making that judgment correctly would need turn-level knowledge, i.e., waiting for the turn to end anyway — which is exactly what `session.idle` provides, with less risk of misfiring on legitimate preamble text. `session.idle` costs one extra API call (`client.session.messages`) but only ever fires once per turn boundary, and does not touch the model-visible content.

Per Verified Findings above, "the turn's output" is not always a single assistant message — a turn with a tool call can span multiple assistant messages (one per model step). The check on `session.idle` must therefore be: take all messages from `client.session.messages`, find the index of the latest `role: "user"` message, and scan every message *after* it (there may be several, all `role: "assistant"`) for a `ToolPart` whose `tool` matches any configured delegate's `{name}_start`/`{name}_reply`. A single-message check would produce false-positive violations whenever the compliant path itself involves a tool call followed by trailing text.

### D3: Compliance check covers all configured delegates' tools, not just the currently-active one's `_reply`
The existing spec's "Switching delegates takes over immediately" scenario means a user can redirect an active delegation by invoking a different delegate's command; the model is then expected to call that *other* delegate's `_start` (or `_reply`, if already started), not the originally-active delegate's `_reply`. The violation check must treat any `{name}_start`/`{name}_reply` call, for any configured delegate, as compliant — otherwise a legitimate delegate switch would be misdetected as a violation and immediately disconnected.

## Risks / Trade-offs

- **[Risk, verified] `noReply: true` semantics** — confirmed by empirical test (see Verified Findings): inserts a `role: "user"` message with the given part(s) and never triggers generation, even after an 8s wait. No longer a design risk; residual risk is only that this is observed behavior of opencode `1.18.4`, not a documented contract, so a future opencode upgrade could change it silently. → **Mitigation**: cover with an integration-style test against a real (or faithfully faked) `client` so a behavior change surfaces as a test failure, not a silent regression in production.
- **[Risk, verified] `session.idle` firing** — confirmed to fire exactly once, strictly after the turn's messages are fully queryable, including for aborted turns (fires ~200ms after `client.session.abort`). → **Mitigation**: treat the handler as idempotent (re-check `getActiveDelegate` at the top), and explicitly check for `info.error?.name === "MessageAbortedError"` on the post-user-message assistant message(s) to exempt user-initiated aborts from the violation check (see Verified Findings).
- **[Risk] Extra `client.session.messages` call on every idle event**, even when no delegation is active for that session. → **Mitigation**: the handler already short-circuits on `!getActiveDelegate(sessionID)` before making the API call, so the cost only applies to sessions with an active delegation.
- **[Trade-off] Detection is always one turn late** — the misleading plain-text answer has already been shown to the user by the time `session.idle` fires and the disconnect notice is posted. This design accepts that trade-off (matches the Non-Goals: prevention is not achievable with these hooks); the value is stopping the *second* silent miss, not the first.

## Migration Plan

No data migration (no new persisted state). Rollout is a plain code change gated by normal test coverage; no feature flag identified as necessary since the behavior is strictly additive to the failure path (compliant turns are unaffected). Suggested sequencing:
1. ~~Empirically confirm the two unverified assumptions in Risks~~ — done, see Verified Findings (2026-07-24).
2. Implement the `event` hook and detection logic (scan all assistant messages after the latest user message, per the D2 correction) behind unit tests using a faked `client`.
3. Update `openspec/specs/cli-dispatch/spec.md` delta and `docs/configuration.md`'s "Known limitations" section to reflect the new behavior.

## Open Questions

- ~~Does `session.idle` fire for aborted/cancelled turns...~~ — resolved, see Verified Findings: it fires, and the aborted assistant message is distinguishable via `info.error.name === "MessageAbortedError"`.
- Should the disconnect notice be worded to actively suggest the exact `/<delegate-name>` command to resume, given `docs/configuration.md` already tells users this is the reliable recovery path?
