# Codex Host Adapter Design

Date: 2026-07-25
Status: Approved for planning

## Context

`opencode-cli-dispatch` currently supports two hosts: OpenCode (via plugin SDK) and Claude Code (via MCP + hooks). Codex CLI (v0.144.6+) already supports MCP servers, lifecycle hooks, and custom prompts, which makes it possible to become a third host without waiting for a Codex-native plugin SDK.

Validation performed on 2026-07-25 confirmed:

- `~/.codex/hooks.json` global hooks fire on `UserPromptSubmit` with full JSON input (`session_id`, `turn_id`, `model`, `permission_mode`, `prompt`).
- `~/.codex/config.toml` can register an MCP server (`codex mcp list` shows it).
- MCP initialize / `notifications/initialized` / `tools/list` handshake works; a real tool call was blocked by OpenAI API 503, not by MCP transport.
- Project-local `.codex/hooks.json` is risky because trust depends on path canonicalization (`/var/folders` vs `/private/var/folders`). Therefore this design writes only to global `~/.codex/` locations.

## Goals

- Allow Codex CLI / desktop / IDE to delegate a conversation to any CLI agent configured in `cli-dispatch.config.json` (claude, codex, opencode, custom raw).
- Reuse existing host-agnostic core: `delegate-turn.ts`, `run-delegate.ts`, `policy.ts`, `session-store` semantics.
- Provide a one-command installer: `cli-dispatch codex setup` (with `--dry-run`, `uninstall`, `doctor`).
- Support session resume (`--resume` / `exec resume`) and best-effort sticky routing.
- Reuse existing security primitives: argv injection guards, externalId validation, prompt template sanitization, verified-models gate.

## Non-Goals

- Publishing to a Codex marketplace or producing a signed plugin package.
- Changing OpenCode or Claude Code adapter behavior.
- Forcing Codex to call a tool when it chooses to answer directly (sticky routing remains best-effort, as in OpenCode).
- Project-local Codex configuration; all artifacts go to `~/.codex/`.

## Architecture

```
Codex host
├─ custom prompts   (~/.codex/prompts/*.md)     entry points: /prompts:claude, /prompts:opencode
├─ hooks            (~/.codex/hooks.json)       UserPromptSubmit / PreToolUse / SessionEnd
├─ MCP server       (cli_dispatch)              {name}_start, {name}_reply, cli_dispatch_status
└─ file-backed store (~/.codex/cli-dispatch/)   active delegation state per Codex session
         │
         ▼
   delegate-turn.ts ── runDelegate ── external CLI (claude / codex / opencode / ...)
```

`opencode` is reserved as the exit prompt name in Codex host; a delegate named `opencode` is rejected by config validation (the `opencode` parser itself remains usable under any other delegate name).

### Module responsibilities

| Module | New/Reuse | Responsibility |
|---|---|---|
| `src/codex-adapter/config.ts` | New | Load `codex-adapter.config.json` (or fallback to `cli-dispatch.config.json`); `verifiedModels` is a bare model slug pattern list (`"gpt-5.6-sol"`, `"gpt-*"`). |
| `src/codex-adapter/mcp-server.ts` | New | stdio MCP server built on `@modelcontextprotocol/sdk`; registers `{name}_start`, `{name}_reply`, and `cli_dispatch_status` tools from config. |
| `src/codex-adapter/store.ts` | New | File-backed `DelegateStore` under `~/.codex/cli-dispatch/` with simple file lock; implements `beginDelegateStart` / `setActiveDelegateIfLatest`. The MCP server learns the current Codex `session_id` from a `current-session` file written by the `UserPromptSubmit` hook (Codex does not pass session id to MCP server processes). |
| `src/codex-adapter/hooks.ts` | New | Hook entry script dispatching by `hook_event_name` to `user-prompt-submit.ts`, `pre-tool-use.ts`, `session-end.ts`. |
| `src/codex-adapter/setup.ts` | New | `cli-dispatch codex setup/update/uninstall` implementation; writes MCP config, hooks, prompts idempotently. |
| `src/codex-adapter/prompts.ts` | New | Generates `~/.codex/prompts/*.md` with `GENERATED_MARKER`; cleans up stale generated files. |
| `src/delegate-turn.ts` | Reuse | start/reply orchestration. |
| `src/run-delegate.ts` | Reuse | subprocess lifecycle. |
| `src/policy.ts` | Reuse | `GENERATED_MARKER`, `EXTERNAL_ID_RE`, `validateArgvInjection`. |

## Configuration and Prompt Generation

### Config file

`codex-adapter.config.json` lookup order:

1. Explicit `configPath`.
2. `./codex-adapter.config.json`
3. `./.codex/cli-dispatch.config.json`
4. `~/.codex/cli-dispatch.config.json`
5. Fallback to existing `cli-dispatch.config.json` search chain.

Structure is the same as `cli-dispatch.config.json` except:

- `verifiedModels` uses bare model slugs because Codex hooks report `model` without a provider dimension:

```json
{
  "delegates": { "...": "..." },
  "verifiedModels": ["gpt-5.6-sol", "gpt-*"]
}
```

- A delegate named `opencode` is rejected (it would collide with the reserved exit prompt). The `opencode` parser can still be used by delegates with any other name.

`verifiedModels` entries are validated with the same trailing-`*` wildcard rules as OpenCode, but without the `provider/` split.

### Generated prompts

Setup writes to `~/.codex/prompts/`:

- `<delegate>.md` for each configured delegate (e.g. `claude.md`, `codex.md`).
- `opencode.md` as the universal exit prompt; it is never generated for a delegate named `opencode`.

Example `claude.md`:

```markdown
---
description: Delegate the current turn to Claude Code
argument-hint: task for Claude Code
---

You are delegating to Claude Code. Call the MCP tool `claude_start` with the user's request as the `prompt` argument. Do not answer directly.
```

Files carry `GENERATED_MARKER`; cleanup removes only generated files, never hand-written prompts.

## Data Flow

### Start delegation

1. User types `/prompts:claude <message>` (or asks Codex to delegate).
2. Codex expands the prompt file and the model calls `claude_start` MCP tool.
3. MCP server invokes `startDelegateTurn` with Codex `session_id`, file-backed store, and home command `/prompts:opencode`.
4. `runDelegate` spawns the external CLI; externalId is validated and stored via `setActiveDelegateIfLatest`.
5. Response returns final text plus change summary.

### Sticky follow-up

1. User sends a plain message.
2. `UserPromptSubmit` hook reads store and finds active delegate `claude`.
3. Hook returns `additionalContext` telling the model to call `claude_reply` with the prompt.
4. Codex model ideally calls `claude_reply`; MCP server resumes the external session via `replyDelegateTurn`.

This is best-effort: if the model answers directly, no hook can force a tool call.

### Exit delegation

1. User types `/prompts:opencode`.
2. `UserPromptSubmit` hook detects the exit keyword, clears the store, and returns a `systemMessage` confirmation.
3. Codex continues normally without a delegation context.

## Hook Behavior

Hook entry `src/codex-adapter/hooks.ts` is registered in `~/.codex/hooks.json` and receives JSON on stdin.

### `UserPromptSubmit`

- Write the incoming `session_id` to `~/.codex/cli-dispatch/current-session` so the long-lived MCP server can key its store correctly.
- If active delegate exists and user sends exit keyword (`/prompts:opencode` or `/opencode`): clear store, return `systemMessage`.
- If active delegate exists and prompt contains `GENERATED_MARKER`: return `decision: "block"` with reason.
- If active delegate exists: return `additionalContext` instructing the model to call `{delegate}_reply`.
- Otherwise: no output (continue).

### `PreToolUse`

- Matcher: `mcp__cli_dispatch__.*` (all tools from our MCP server).
- If tool is `{name}_start` or `{name}_reply`:
  - Deny when `tool_input.prompt` contains `GENERATED_MARKER`.
  - When `verifiedModels` is configured, deny when the current `model` is not allowed; unknown model fails open.
- Other tools: no output.

### `SessionEnd`

- Remove the current session's entry from the store (advisory cleanup).

## Error Handling

| Failure | Where surfaced | User-facing text |
|---|---|---|
| External CLI binary missing | MCP tool error | `claude failed: binary not found. Use /prompts:opencode to exit delegation.` |
| External CLI non-zero exit | MCP tool error | exit code + capped stderr excerpt |
| Timeout / cancellation | MCP tool error | `timeout after 10m` / `cancelled by user` |
| Config invalid | `cli-dispatch codex setup` fails | path + field + fix hint |
| Model not in `verifiedModels` | `PreToolUse` deny | `当前模型 gpt-5.6-sol 未在允许列表，已阻止调用 claude_start` |
| Prompt template forwarded | `UserPromptSubmit` / `PreToolUse` block | `不要直接把整个命令模板作为 prompt 传过来` |

## Security

- Reuses `src/policy.ts` unchanged: `GENERATED_MARKER`, `EXTERNAL_ID_RE`, `validateArgvInjection`.
- Store directory `~/.codex/cli-dispatch/` is created `0700`; state files `0600`.
- Hook scripts treat `session_id`, `model`, and `prompt` as untrusted input; session ids are validated before being used as filenames.
- `cli-dispatch codex setup --dry-run` only prints planned writes.

## Testing

| Test file | Coverage |
|---|---|
| `codex-adapter-config.test.ts` | config loading, fallback, `verifiedModels` matching |
| `codex-adapter-store.test.ts` | file-backed store, TTL, lock, sequence race |
| `codex-adapter-mcp-server.test.ts` | tool registration, start/reply wiring |
| `codex-adapter-hooks.test.ts` | sticky context, exit, prompt sanitization, model gate |
| `codex-adapter-setup.test.ts` | idempotent setup, marker protection, dry-run, uninstall |

Integration tests simulate a full delegation with a fake MCP server and fake hook inputs. CI runs `bun test`, `bun run build`, and `git diff --exit-code dist/`.

## Delivery

```bash
cli-dispatch codex setup [--dry-run]   # install/update global Codex config
cli-dispatch codex uninstall           # remove generated artifacts
cli-dispatch codex doctor              # verify MCP server, hooks, prompts
```

Setup actions:

1. Ensure `~/.codex/cli-dispatch/` exists (`0700`).
2. Append `[mcp_servers.cli_dispatch]` to `~/.codex/config.toml` pointing to the compiled MCP server entry.
3. Append `UserPromptSubmit`, `PreToolUse`, `SessionEnd` hooks to `~/.codex/hooks.json`.
4. Write/update delegate prompts in `~/.codex/prompts/` and remove stale generated files.
5. Tell the user to run `/hooks` in Codex to trust the hooks and restart Codex.

## Key Design Decisions

| Decision | Rationale |
|---|---|
| Global `~/.codex/` only | Project-local trust is fragile across path aliases; global config is stable and documented. |
| MCP server + hooks + prompts | These are the three public extension surfaces Codex already supports; no internal API dependency. |
| File-backed store + current-session file | Each hook invocation is a separate process; the MCP server is long-lived but Codex does not give it the session id, so the `UserPromptSubmit` hook writes the current `session_id` to a file the MCP server reads. |
| Separate `codex-adapter.config.json` | Codex exposes bare model slugs, not `provider/model`, so verified-models patterns differ from OpenCode. |
| `/prompts:opencode` as exit | Codex has no deterministic slash-command interception hook, so a custom prompt plus `UserPromptSubmit` detection is the closest equivalent. The name is reserved, so a delegate named `opencode` is rejected. |
