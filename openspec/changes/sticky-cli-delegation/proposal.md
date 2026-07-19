## Why

Delegation (`/cc`, `/codex`) is currently implemented as instructions in the message stream, so any intervening command (e.g. `/opsx-explore`) silently breaks the sticky routing and opencode starts answering with its own model again. There is also no command to exit delegation back to opencode — once delegated, the only way out is switching to the other delegate or abandoning the session. Verified by live spike: these are mechanism problems, not model problems.

## What Changes

- Move sticky routing from message-stream instructions to the plugin layer: when a session has an active delegate, inject the routing rule into the system prompt on every LLM call via `experimental.chat.system.transform`, so intervening commands no longer override delegation.
- Add an `/opencode` command that exits delegation: intercepted deterministically in `command.execute.before` (plugin clears session state directly, no reliance on the model calling a tool).
- While delegated, all user input — including command invocations like `/opsx-explore` — is forwarded to the active delegate as prompt content, so the delegate (not opencode's model) handles it.
- Keep the existing fallback: `claude_reply`/`codex_reply` still throw when no session is active, and command docs still instruct `*_start` recovery.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `cli-dispatch`: sticky routing SHALL survive intervening non-delegate commands; all input while delegated (including commands) routes to the delegate; a `/opencode` command SHALL exit delegation deterministically.

## Impact

- `.opencode/plugin/cli-dispatch.ts` — register `experimental.chat.system.transform` and `command.execute.before` hooks
- `.opencode/lib/cli-dispatch/session-store.ts` — reused as-is (`getActiveDelegate`/`clearActiveDelegate` already exist)
- `.opencode/command/opencode.md` — new command file for exiting delegation
- `.opencode/command/cc.md`, `.opencode/command/codex.md` — docs updated to describe the new exit path and command-forwarding semantics
- Verified facts from spike (opencode 1.18.3): `system.transform` fires on command turns, receives `sessionID`, and mutations take effect; `command.execute.before` fires before message creation with command name + sessionID
- No new dependencies; no breaking changes to the tool API (`claude_start`/`claude_reply`/`codex_start`/`codex_reply` unchanged)
