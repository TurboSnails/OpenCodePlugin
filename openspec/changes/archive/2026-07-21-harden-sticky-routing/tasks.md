## 1. Spike: confirm hook behavior before committing to the mechanism (DONE, 2026-07-21)

- [x] 1.1 Stand up a persistent `opencode serve` session (same methodology as `archive/2026-07-20-delegate-permission-passthrough`) and add a throwaway debug hook logging every `tool.execute.before` invocation; confirm live whether it fires for this plugin's dynamically-registered `{name}_start`/`{name}_reply` tools. Record the result in `design.md`. **Result: confirmed working — fires with mutable `args`.**
- [x] 1.2 In the same spike, confirm whether `chat.message` fires before `command.execute.before` for a session's very first message when that message is a delegate-start command. Record the result in `design.md`. **Result: `command.execute.before` fires first — fail-open for unknown model is required, not optional.**
- [x] 1.3 Based on 1.1's result, finalize the sanitization mechanism: `tool.execute.before` confirmed working, so implement as a hook (no guard-clause fallback needed).
- [x] 1.4 Removed the throwaway debug hook; `src/index.ts` reverted to its pre-spike state.

## 2. Session model tracking

- [x] 2.1 Add `sessionModels: Map<sessionID, {providerID: string; modelID: string}>` to `src/session-store.ts`, with `getSessionModel`/`setSessionModel`, mirroring the existing `sessionAgents` pattern.
- [x] 2.2 In `src/hooks.ts#makeChatMessage`, call `setSessionModel` whenever `input.model` is present, alongside the existing `setSessionAgent` call.

## 3. Config schema

- [x] 3.1 Add optional `verifiedModels?: string[]` to `CliDispatchConfig` in `src/config.ts`.
- [x] 3.2 In `validateConfig`, validate each `verifiedModels` entry matches `provider/model` shape (each segment non-empty, optional trailing `*`); fail with an error naming the invalid entry. Missing/empty field imposes no restriction.
- [x] 3.3 Add a small matcher function (e.g. `matchesVerifiedModel(model, patterns)`) supporting exact match and trailing-`*` wildcard per segment, case-sensitive.

## 4. Command-start gate

- [x] 4.0 Spiked `output.parts` at `command.execute.before` entry (live `opencode serve`, `/cc`): confirmed it already holds the expanded command template text, and `input.command` is the literal typed name (`"cc"`), not the delegate key (`"claude"`). See design.md D1 correction.
- [x] 4.1 In `src/hooks.ts#makeCommandBefore`, before the existing `/opencode`-only early return: scan `output.parts`' text for `` `{name}_start` `` for each configured delegate name to detect which delegate (if any) this command targets, regardless of the command's own name.
- [x] 4.2 If a delegate is detected, `verifiedModels` is configured/non-empty, a model is tracked for the session, and it matches no entry: clear `output.parts` (`output.parts.length = 0`) and push only a message naming the model and the reason, preventing the queued `{name}_start` instructions from reaching the model.
- [x] 4.3 If no model is tracked yet for the session, or no delegate is detected, or `verifiedModels` is unconfigured/empty, or the model matches: leave `output.parts` untouched (fail open, per design D2).
- [x] 4.4 Live end-to-end spike (`opencode serve`, temp `cli-dispatch.config.json` with `verifiedModels: ["anthropic/*"]`, `kimi-for-coding/k3`): first `/cc` in a fresh session passed through (model untracked yet, fail-open); second `/cc` in the same session (model now tracked, unverified) was blocked — no `claude_start` tool call occurred, model relayed the block message instead. Temp config file reverted afterward via `git checkout`.

## 5. Prompt sanitization

- [x] 5.1 Implement a new `tool.execute.before` hook (`src/hooks.ts`, wired in `src/index.ts`): when `input.tool` matches a configured `{name}_start`/`{name}_reply`, reject `output.args.prompt` containing `commands.ts`'s `GENERATED_MARKER` with an actionable error, without spawning the delegate CLI.
- [x] 5.2 Live spike confirmed throwing inside `tool.execute.before` fully blocks the tool's `execute()` from running (no delegate CLI spawned; the calling model received the thrown error and reported it did not delegate).

## 6. Documentation cleanup

- [x] 6.1 Removed the "Known limitations: MiniMax-M3 ..." paragraph from `.opencode/command/cc.md`.
- [x] 6.2 Checked `src/commands.ts`'s `DELEGATE_COMMAND_TEMPLATE`/`OPENCODE_COMMAND_TEMPLATE` (never carried this text) and `.opencode/command/codex.md` (carried the identical paragraph — removed).
- [x] 6.3 Document `verifiedModels` configuration (schema, matching syntax, fail-open behavior for untracked models) in `README.md` and `README_CN.md`.

## 7. Tests

- [x] 7.1 Unit tests for the `verifiedModels` validator and matcher in `src/config.ts` (valid/invalid entries, wildcard matching, empty/absent field).
- [x] 7.2 Unit tests for `session-store.ts`'s model tracking (`getSessionModel`/`setSessionModel`) and `makeChatMessage`'s model caching.
- [x] 7.3 Unit tests for `makeCommandBefore`'s gating logic (verified model passes through, unverified model blocked, untracked model fails open, no allow-list configured imposes no restriction, non-delegate command untouched) plus the pre-existing `/opencode` exit branch (previously untested).
- [x] 7.4 Unit tests for the prompt-sanitization check (template marker present → rejected for both `_start`/`_reply`, ordinary prompt → passes through, non-delegate tool → ignored).
