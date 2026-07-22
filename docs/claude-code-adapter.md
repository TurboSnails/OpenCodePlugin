# Claude Code adapter

Claude Code can also act as a host, delegating to `codex` and `opencode` with the same sticky-routing/verified-models/prompt-sanitization contract — implemented on Claude Code's primitives instead of OpenCode's. An MCP server registers the delegate tools, and `PreToolUse`/`UserPromptSubmit` hooks (short-lived shell processes, configured in `.claude/settings.json`) provide the template sanitization, the sticky routing-rule injection, the verified-models gate, and the `/cc` exit command. This repo dogfoods the adapter; the files below are its working setup:

1. `.mcp.json` registers the `cli-dispatch` MCP server (`bun run src/claude-code-adapter/mcp-server.ts`). The first time Claude Code sees a project-scoped `.mcp.json`, it asks for a **one-time interactive approval** — approve it, or the delegate tools never appear. The hooks deliberately don't depend on the MCP server being up: the `/cc` exit and the verified-models block work even before approval.
2. `.claude/settings.json` registers the two hooks.
3. `.claude/commands/` provides `/codex` and `/opencode` (delegate out) and `/cc` (come home — the same "say the host's own name" convention as OpenCode's `/opencode`).

Configuration lives in `claude-code-adapter.config.json` at the project root (falling back to a built-in codex+opencode default when absent). The `delegates` entries use the exact same shape as the OpenCode [Configuration](configuration.md) above. The adapter's `verifiedModels` differs in shape from OpenCode's `provider/model` pairs: Claude Code exposes no provider dimension, so entries are bare model-string patterns (`"claude-sonnet-5"`, `"claude-*"`, `"*"`) — trailing `*` wildcard, case-sensitive, with the same fail-open-when-the-model-is-unknown policy as [Verified models](configuration.md#verified-models).

Delegation state (active delegate, external session id) is persisted as one small JSON file per Claude Code session under the OS temp dir (`cli-dispatch-claude-code/`), because each hook invocation is a separate process; the current model is not persisted — it is read fresh from the session transcript on every check.
