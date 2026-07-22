# opencode-cli-dispatch

[中文文档](README_CN.md)

An [OpenCode](https://opencode.ai) plugin that delegates a conversation to an external CLI coding agent (Claude Code, Codex, or any other CLI agent you configure) and streams its response back into the OpenCode chat. Delegation is **sticky on a best-effort basis**: once started, follow-up messages in the session keep being routed to the same delegate until you explicitly exit — but this relies on the model calling the delegate's reply tool, which no hook can force (see [Known limitations](docs/configuration.md#known-limitations)). An explicit `/<delegate> <message>` command is the reliable way to reach the delegate.

## Quickstart

```bash
# 1. install the plugin (in any opencode project, or globally)
bun add opencode-cli-dispatch
```

```jsonc
// 2. register it — opencode.json (project) or ~/.config/opencode/opencode.json (global)
{
  "plugin": ["opencode-cli-dispatch"]
}
```

```
3. in opencode: /claude hello        # or /codex hello
```

Slash commands (`/<delegate>`, `/cc`, `/opencode`) are written to `~/.config/opencode/commands/` automatically on plugin load.

**Stuck?** Run `npx opencode-cli-dispatch doctor` (or `cli-dispatch doctor --fix`) — it checks registration, config, binaries, authentication, writability, and slash commands, and tells you exactly what to fix.

Full docs: [Installation](docs/installation.md) · [Configuration](docs/configuration.md) · [Claude Code adapter](docs/claude-code-adapter.md)

## Features

- **Multi-delegate**: any number of CLI agents can be configured side by side (ships with `claude` and `codex` presets).
- **Best-effort sticky routing**: after `/cc` or `/codex`, subsequent messages — including plain text and other slash commands — are forwarded to the active delegate until `/opencode` is run. This depends on model compliance; a model answering directly is outside the plugin's control.
- **Session resume**: each delegate keeps its own external session id, so follow-ups resume the underlying CLI session (`--resume` / `exec resume`) instead of starting fresh.
- **Auto-generated commands**: `/{name}`, `/{name}_reply`-driving slash commands are generated per configured delegate, plus a shared `/opencode` exit command.
- **Change summaries**: each delegate turn diffs the git worktree before/after the run and appends a short summary (`git diff --stat` + new untracked files) to the response.
- **Health checks**: a `{name}_check` tool spawns the delegate in an isolated temp directory to verify it can actually write files with the configured permission flags, without touching your workspace.
- **Restrictive-agent guard**: warns instead of silently misbehaving when the active OpenCode agent (e.g. `plan`) injects a system prompt that blocks tool calls, which would otherwise make the delegate silently fail.

## How it works

Each configured delegate (e.g. `claude`, `codex`) gets three tools generated at plugin load time:

| Tool | Purpose |
|---|---|
| `{name}_start` | Starts a new CLI session with a prompt, spawns the binary, and records the external session id. |
| `{name}_reply` | Resumes the active session for this conversation with a follow-up prompt. |
| `{name}_check` | Spawns the delegate in an isolated temp dir and confirms it can write files (permission/sandbox sanity check). |

Hooks wire this into OpenCode's chat loop:

- `experimental.chat.system.transform` injects a routing rule into the system prompt while a delegation is active, so the model calls `{name}_reply` instead of answering directly.
- `chat.message` tracks the current OpenCode agent per session (used for the restrictive-agent guard) and cleans up injected `@mention` boilerplate text.
- `command.execute.before` intercepts `/opencode` to deterministically clear the active delegation for the session.

Active delegate state (which delegate, which external session id, which OpenCode agent) is kept in an in-memory session store, keyed by OpenCode session id.

## Installation

See [docs/installation.md](docs/installation.md) for building, packaging, and per-project or global install options.

## Configuration

See [docs/configuration.md](docs/configuration.md) for delegate configuration, verified models, permissions, and known limitations.

## Claude Code adapter

See [docs/claude-code-adapter.md](docs/claude-code-adapter.md) for using the adapter with Claude Code as the host.

## Development

```bash
bun install
bun run build   # tsc -> dist/
bun run dev      # tsc --watch
bun test         # bun test, see src/__tests__
```

Source layout:

| File | Responsibility |
|---|---|
| [src/index.ts](src/index.ts) | Plugin entry point; wires config, tools, hooks together. |
| [src/config.ts](src/config.ts) | Config loading/validation and `{placeholder}` argv resolution. |
| [src/delegate-tools.ts](src/delegate-tools.ts) | `{name}_start` / `{name}_reply` tool implementations, git-diff change summaries. |
| [src/health-check.ts](src/health-check.ts) | `{name}_check` tool — isolated writability probe. |
| [src/hooks.ts](src/hooks.ts) | System-prompt routing injection, agent tracking, `/opencode` exit handling. |
| [src/commands.ts](src/commands.ts) | Generates the `/{name}` and `/opencode` markdown command files. |
| [src/routing-rule.ts](src/routing-rule.ts) | Builds the sticky-routing instruction injected into the system prompt. |
| [src/run-delegate.ts](src/run-delegate.ts) | Spawns the delegate binary and streams stdout to a parser. |
| [src/parse-events.ts](src/parse-events.ts) | Per-CLI stdout event parsers (`claude`, `codex`, `opencode`, `raw`). |
| [src/session-store.ts](src/session-store.ts) | In-memory per-OpenCode-session delegate/agent state. |
| [src/claude-code-adapter/](src/claude-code-adapter) | Claude Code host adapter: MCP server, `PreToolUse`/`UserPromptSubmit` hooks, file-backed session store. |

## License

MIT
