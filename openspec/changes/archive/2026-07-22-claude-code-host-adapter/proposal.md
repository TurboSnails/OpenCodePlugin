## Why

This plugin currently only runs as an OpenCode plugin: OpenCode is the sole "host" that can delegate a conversation out to `claude`/`codex` CLIs. The user regularly works across three CLI coding agents (OpenCode, Claude Code, Codex) and wants them to eventually be fully symmetric — any one able to delegate to, and be delegated from, either of the other two. This change is the first concrete step toward that: making Claude Code itself a second host capable of delegating out to `codex` and `opencode`, using the same sticky-routing/verified-models/prompt-sanitization behavior this repo already built and shipped for OpenCode (`harden-sticky-routing`, archived 2026-07-21).

Codex becoming a host is explicitly out of scope here — it is a separate, uncommitted research question (this repo's own archived `delegate-permission-passthrough/design.md` found no plugin/hook surface in `codex --help`/`codex exec --help` as of 2026-07-20, but that needs re-checking against the current version before any commitment).

## What Changes

- New Claude Code adapter package/directory providing:
  - An MCP server registering `codex_start`/`codex_reply` and `opencode_start`/`opencode_reply` tools, reusing `run-delegate.ts` and `parse-events.ts` to spawn `codex exec`/`opencode run --format json` headlessly.
  - A `PreToolUse` hook (matching the new tools) implementing the same prompt-template-sanitization check as OpenCode's `tool.execute.before` (`makeToolExecuteBefore`).
  - A `UserPromptSubmit` hook implementing the combined role of OpenCode's `experimental.chat.system.transform` (inject the sticky routing rule while a delegation is active) and `command.execute.before` (detect delegate-start commands, apply the `verifiedModels` gate, detect the "come home" command).
  - `.claude/commands/*.md` slash commands: `/codex` and `/opencode` (delegate out), `/cc` (exit any active delegation and return to Claude Code — same "say the host's own name to come home" convention as OpenCode's existing `/opencode` command, and consistent with this repo's existing `.opencode/command/cc.md` alias).
- New "opencode" parser in `src/parse-events.ts`, alongside the existing `claude`/`codex`/`raw` parsers, so `opencode run --format json` output (confirmed live: JSON lines, `sessionID` on every line, `-s <id> -c` resumes correctly) can be parsed the same way `codex`'s JSONL stream is today.
- Session state (active delegate, external session id, tracked model for `verifiedModels`) needs a persistence mechanism that survives across separate hook-process invocations (Claude Code hooks are short-lived shell processes, unlike OpenCode's single long-lived plugin process where `session-store.ts`'s in-memory `Map`s are naturally shared). The exact mechanism (file/SQLite-backed store vs. MCP-server-mediated state) is an open design decision, not yet resolved — see design.md.
- **BREAKING**: none. This is a wholly new adapter; the existing OpenCode plugin (`src/index.ts`, `src/hooks.ts`, etc.) is unmodified except for the new parser in `parse-events.ts`, which is additive.

## Capabilities

### New Capabilities
- `claude-code-host-adapter`: Claude Code acting as a delegation host — MCP-registered delegate tools, `PreToolUse`/`UserPromptSubmit` hooks providing the sticky-routing/verified-models/prompt-sanitization contract, and the "own name = come home" exit command, mirroring the existing `cli-dispatch` capability's behavior but implemented on Claude Code's extensibility primitives instead of OpenCode's.

### Modified Capabilities
- `config-driven-delegates`: adds `"opencode"` as a fourth built-in parser value (alongside `"claude"`, `"codex"`, `"raw"`), for parsing `opencode run --format json` output.

## Impact

- New files under a Claude Code adapter directory (exact layout TBD in design.md): MCP server entrypoint, `PreToolUse`/`UserPromptSubmit` hook scripts, `.claude/commands/*.md`.
- `src/parse-events.ts`: new `parseOpencodeLine` (name TBD) function and `ParserName` type gains `"opencode"`.
- `src/config.ts`: `ParserName` union type updated; existing `claude`/`codex`/`raw` validation logic extended, not replaced.
- `run-delegate.ts`, `config.ts`'s `verifiedModels` matcher, `routing-rule.ts` are reused as-is (confirmed host-agnostic in the `harden-sticky-routing` portability audit).
- Does not touch anything under `src/hooks.ts`, `src/index.ts`, `src/delegate-tools.ts`, `src/health-check.ts` (OpenCode-specific, untouched by this change).
- Requires a live spike against a real Claude Code session (MCP server + hooks) before implementation commits to the session-state persistence mechanism — see design.md.
