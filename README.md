# opencode-cli-dispatch

OpenCode plugin for delegating conversations to external CLI agents (Claude, Codex, etc.), configured via `cli-dispatch.config.json`.

## Delegate permissions

Each delegate runs as a separate subprocess with its own permission/sandbox system, controlled by flags in `cli-dispatch.config.json`.

**Delegates are expected to be configured with write capability.** If a delegate cannot edit files, check its flags first, or run the `{name}_check` tool (e.g. `claude_check`) to verify writability in an isolated directory.

### claude

`--permission-mode <mode>`:

| Mode | Effect |
|---|---|
| `bypassPermissions` | All tool actions allowed without asking (default in this package) |
| `acceptEdits` | File edits auto-accepted; other actions still gated |
| `dontAsk` | Actions requiring permission are **denied without asking** — effectively read-only |
| `plan` | Read-only planning mode |

### codex

`-c sandbox_mode=<mode>`:

| Mode | Effect |
|---|---|
| `workspace-write` | Can write inside the workspace (default in this package) |
| `read-only` | Cannot write anywhere |

### Permissions are baked in at spawn time

A delegate session keeps the flags it was started with for its entire lifetime (replies resume the same session). **After editing `cli-dispatch.config.json`, exit the active delegation (`/opencode`) and start a fresh one** — existing delegate sessions do not pick up the new flags.
