## Why

The user already authenticates with and pays for three separate coding-agent CLIs (`codex`, `claude`, `kimi`), each with its own context management, tool execution, and agent loop. They want to drive all three from a single opencode session instead of switching terminals, without reconfiguring API keys or reimplementing any of those CLIs' own agent logic. Today opencode has no way to hand a task to an external CLI's own agent loop and get routed follow-up turns back to it.

## What Changes

- Add a project-local opencode plugin (`.opencode/plugin/cli-dispatch.ts`) that registers six tools — `codex_start`/`codex_reply`, `claude_start`/`claude_reply`, `kimi_start`/`kimi_reply` — each of which spawns the corresponding CLI in headless streaming mode (`codex exec --json`, `claude -p --output-format stream-json`, `kimi --print --output-format stream-json`) and reports live progress via the plugin SDK's `context.metadata()`.
- Add three opencode command templates (`.opencode/command/codex.md`, `cc.md`, `kimi.md`) that route the current message to the matching `*_start`/`*_reply` tool and instruct the model to keep replying to the same delegate on subsequent turns (sticky delegation) until another `/codex`/`/cc`/`/kimi` command takes over.
- Session/thread continuity per delegate is tracked in an in-memory map inside the plugin, keyed by the opencode session ID, storing each delegate's own thread/session identifier (`threadId` for codex, `--session-id`/`--resume` UUID for claude, `--session`/`--continue` ID for kimi).

## Capabilities

### New Capabilities
- `cli-dispatch`: opencode plugin + commands that delegate a conversation to codex/claude/kimi's own CLI agent loop via subprocess, with sticky multi-turn routing and live progress reporting.

### Modified Capabilities
(none — no existing specs in this project)

## Impact

- New files only: `.opencode/plugin/cli-dispatch.ts` (or split into per-CLI modules under `.opencode/plugin/`) and `.opencode/command/{codex,cc,kimi}.md`.
- Depends on the user having `codex`, `claude`, and `kimi` CLIs installed and already authenticated locally; no new credentials or API keys are introduced.
- No MCP server is registered or run for this capability; delegation happens entirely through opencode's plugin `tool()` API and local subprocesses.
- Explicitly out of scope: mirroring superpowers skills (e.g. brainstorming) into `~/.codex/skills` or a kimi skills directory so a delegated CLI can run them natively — follow-up work, tracked separately, following the existing manual `android-cli` mirroring precedent already used in this project. Also out of scope: `~/ClaudeCodeKimi` and `~/.gemini-proxy` (unrelated prior projects that swap Claude Code's backing model for Kimi's API — not reused or integrated).
