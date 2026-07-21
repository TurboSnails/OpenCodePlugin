## Why

Sticky delegation currently relies entirely on a natural-language convention: the `/cc`/`/codex`-style command markdown asks the model to call `{name}_start`/`{name}_reply`, and `experimental.chat.system.transform` injects a routing rule asking the model not to answer directly. Verified against MiniMax-M3 (2026-07-19, documented as a "Known limitation" in `.opencode/command/cc.md`): it forwards the entire expanded command template as the `{name}_start` prompt argument (causing the delegate CLI to refuse as a suspected injection), and it ignores the sticky routing rule on follow-ups, answering directly instead of calling `{name}_reply`. Today the only mitigation is a hand-maintained blacklist paragraph naming specific models in command docs, which is not discoverable at runtime, doesn't cover new bad models automatically, and gives the model itself no way to be stopped before causing a confusing failure.

## What Changes

- Track the model (`providerID`/`modelID`) active for each opencode session, sourced from the existing `chat.message` hook, alongside the already-tracked session agent.
- Add an optional `verifiedModels` allow-list to the top-level `cli-dispatch.config.json` schema (glob-style provider/model strings). Absent config imposes no restriction (fully backward compatible).
- When `command.execute.before` intercepts a delegate-start command (e.g. `/cc`, `/codex`) and the session's tracked model doesn't match the allow-list (allow-list configured and non-empty), the plugin SHALL block the delegation before it starts and return an explicit message naming the model and suggesting a verified alternative — `{name}_start` is never called.
- Add sanitization in a new `tool.execute.before` hook for `{name}_start`/`{name}_reply`: if `args.prompt` contains the generated-command marker or otherwise appears to be the whole expanded command template rather than the user's actual text, reject the call with an actionable error instead of forwarding it to the delegate CLI.
- **BREAKING**: none. `verifiedModels` is opt-in; omitting it preserves current unrestricted behavior exactly.
- Remove the hand-maintained "Known limitations: MiniMax-M3 ..." paragraph from `.opencode/command/cc.md` (and any equivalent text in other generated command templates in `src/commands.ts`) now that the allow-list mechanism supersedes documenting bad models in prose.
- Document `verifiedModels` configuration in `README.md`/`README_CN.md`.

## Capabilities

### New Capabilities
(none — this extends existing capabilities rather than introducing a new one)

### Modified Capabilities
- `cli-dispatch`: adds model-based gating before a delegation starts, and prompt-argument sanitization before a delegate tool call reaches the CLI.
- `config-driven-delegates`: adds an optional top-level `verifiedModels` field to the config schema.

## Impact

- `src/session-store.ts`: new per-session model cache (`getSessionModel`/`setSessionModel`), mirroring the existing agent cache.
- `src/hooks.ts`: `makeChatMessage` records the model; `makeCommandBefore` gains the allow-list check for delegate-start commands; new `makeToolExecuteBefore` (or equivalent) for prompt sanitization.
- `src/index.ts`: wires the new `tool.execute.before` hook into the returned `Hooks` object.
- `src/config.ts`: `CliDispatchConfig`/`validateConfig` gain `verifiedModels`.
- `src/commands.ts`: delegate command template must still tell the model which command to run when blocked (no change to generation logic otherwise); `.opencode/command/cc.md` (and any hand-maintained equivalents) loses the MiniMax-M3-specific paragraph.
- `README.md`/`README_CN.md`: new configuration section.
- Needs a live spike (same methodology as the archived `delegate-permission-passthrough` change) to confirm `tool.execute.before` actually fires for this plugin's custom tools before committing to the sanitization mechanism — `permission.ask` was previously confirmed (2026-07-20) to never fire for custom plugin tool calls in opencode 1.18.3, so this cannot be assumed without verification.
