## Why

Sticky delegation depends entirely on the model's willingness to call `{name}_reply` on every follow-up turn instead of answering directly. The current spec (`cli-dispatch` capability, "Sticky multi-turn delegation" requirement, scenario "Model answering directly is outside plugin control") documents this as an accepted, permanent limitation: "no hook fires for a plain-text answer." That statement is true only for the hooks the plugin currently registers (`chat.message`, `experimental.chat.system.transform`, `command.execute.before`, `tool.execute.before`).

Two pieces of the `@opencode-ai/plugin`/`@opencode-ai/sdk` surface are available but unused: the `event` hook (which receives `session.idle`, fired once the model's turn ends) and the `client: OpencodeClient` passed into the plugin at setup (`client.session.messages(...)` can fetch the just-finished turn's message parts). Together they make the violation *detectable* after the fact, even though it can never be *prevented* (no hook can force a tool call).

Today, when a model silently ignores sticky routing, the session store still reports the delegation as active and the routing rule keeps getting injected — the user has no signal that anything went wrong, and may keep believing their messages are reaching the delegate CLI when they are not. This change closes that transparency gap: it does not attempt to force compliance (impossible), only to stop misleading the user once non-compliance is observed.

## What Changes

- Add a `event` hook to the plugin that reacts to `session.idle`.
- On `session.idle` for a session with an active delegation, fetch the just-completed assistant message via `client.session.messages` and check whether any of its parts is a tool call to any configured delegate's `{name}_start` or `{name}_reply` (covering the existing "switching delegates" exception — calling a *different* delegate's tool is compliant, not a violation).
- If no such tool call is found, treat the turn as a routing violation:
  - Clear the active delegation for that session (reuses the existing `clearActiveDelegate`; no new session-store state).
  - Leave a visible, synthetic notice in the transcript that sticky delegation was disconnected and why, using `client.session.prompt` with `noReply: true` so it does not trigger a new model turn.
- Update the `cli-dispatch` spec's "Sticky multi-turn delegation" requirement: the "Model answering directly is outside plugin control" scenario changes from "this is permanent, no recovery signal" to "the plugin detects this after the fact and disconnects with a visible notice instead of staying silently active."

This is a detection-and-disconnect mechanism only. It explicitly does **not**:
- Retry or auto-correct the model's turn.
- Guarantee detection of every violation (the `session.idle`/`client.session.messages` sequencing and the exact semantics of `noReply` are unverified assumptions — see `design.md`).
- Change the `verifiedModels` allow-list behavior, which remains the preventive (start-time) half of this problem.

## Capabilities

### New Capabilities
(none)

### Modified Capabilities
- `cli-dispatch`: the "Sticky multi-turn delegation" requirement's "Model answering directly is outside plugin control" scenario changes — a violation is now detected via the `event`/`session.idle` hook and disconnects the delegation with a visible notice, instead of remaining a silent, undetectable limitation.

## Impact

- `src/index.ts`: register a new `event` hook in the returned `Hooks` object.
- `src/hooks.ts`: new function (e.g. `makeSessionIdle` or similar) implementing the detection-and-disconnect logic; needs read access to `config.delegates` (to build the compliant tool-name set) and the `client` from `PluginInput`.
- `src/session-store.ts`: no new fields; reuses `getActiveDelegate`/`clearActiveDelegate`.
- `openspec/specs/cli-dispatch/spec.md`: delta to the "Sticky multi-turn delegation" requirement and its "Model answering directly" scenario.
- `docs/configuration.md`: the "Known limitations" section currently states this case is permanent and undetectable — needs updating to describe the new disconnect-on-violation behavior once implemented.
- New dependency on `client.session.messages` and `client.session.prompt({ noReply: true })` from `@opencode-ai/plugin`'s `PluginInput.client` — no new package dependency, but a new usage of an existing one.
