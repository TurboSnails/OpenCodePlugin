# Codex adapter

Codex can also act as a host, delegating to `claude`, `codex`, or any other configured CLI agent with the same sticky-routing/verified-models/prompt-sanitization contract as the OpenCode plugin — implemented on Codex's own primitives: a stdio MCP server for the delegate tools, `UserPromptSubmit`/`PreToolUse`/`SessionEnd` hooks for routing and policy, and generated custom prompts (`/prompts:<delegate>`, `/prompts:opencode`) as the user entry points.

## Setup

```bash
cli-dispatch codex setup        # install/update global Codex config (~/.codex/)
cli-dispatch codex setup --dry-run   # preview changes without writing
cli-dispatch codex doctor       # verify installation
cli-dispatch codex uninstall    # remove generated artifacts
```

Setup is idempotent and writes only to global `~/.codex/` locations:

1. `[mcp_servers.cli_dispatch]` in `~/.codex/config.toml` (section-based upsert, surrounding content preserved).
2. `UserPromptSubmit`, `PreToolUse`, `SessionEnd` hooks in `~/.codex/hooks.json` (deduplicated by command string).
3. Delegate prompts in `~/.codex/prompts/` (`<delegate>.md` per configured delegate plus `opencode.md` as the exit prompt; only files carrying `GENERATED_MARKER` are ever removed).
4. State directory `~/.codex/cli-dispatch/` (mode `0700`).

After setup, run `/hooks` in Codex to review and trust the new hooks, then restart Codex.

## Usage

- `/prompts:claude <message>` — start delegating to the `claude` delegate (one prompt per configured delegate).
- `/prompts:opencode` — exit the active delegation; Codex answers directly again.
- While a delegation is active, follow-up messages are routed to `{delegate}_reply` via a `UserPromptSubmit`-injected routing instruction — **best-effort**, exactly like the OpenCode host: no hook can force the model to call the reply tool.
- `cli_dispatch_status` MCP tool — report the active delegation for the current session.

## Configuration

`codex-adapter.config.json` is resolved from (first match wins): `./codex-adapter.config.json`, `./.codex/cli-dispatch.config.json`, `~/.codex/cli-dispatch.config.json`, falling back to the `delegates` of the main `cli-dispatch.config.json`. The `delegates` entries use the exact same shape as the OpenCode [Configuration](configuration.md). Two differences:

- `verifiedModels` entries are **bare model-string patterns** (`"gpt-5.6-sol"`, `"gpt-*"`, `"*"`) — Codex hooks expose no provider dimension. Same trailing-`*` wildcard, case-sensitive, fail-open-when-the-model-is-unknown policy as [Verified models](configuration.md#verified-models).
- A delegate named `opencode` is rejected: the name is reserved for the exit prompt (`/prompts:opencode`). The `opencode` parser remains usable under any other delegate name.

## Session id discovery (D-store)

Codex does not pass the session id to MCP server processes, and each hook invocation is a separate short-lived process. The `UserPromptSubmit` hook therefore writes the current `session_id` to `~/.codex/cli-dispatch/current-session` (atomic write-temp-then-rename) on every prompt, and the long-lived MCP server reads that file when a delegate tool is called. Delegation state itself is one small JSON file per session in the same directory, reusing the Claude Code adapter's `fileDelegateStore` with a 24-hour TTL.

## Security

- Same shared primitives as the other hosts: `GENERATED_MARKER` template-forwarding rejection (in both `UserPromptSubmit` and `PreToolUse`), `EXTERNAL_ID_RE` validation, and argv-injection config validation. A parser-reported session id that fails validation falls back to a client-generated id **and logs a warning** that the next reply may not resume correctly.
- `PreToolUse` (matcher `mcp__cli_dispatch__.*`) applies the verified-models gate to direct tool calls, closing the bypass around the prompt path; unknown model fails open.
- Hook entry always exits `0` with a JSON object on stdout, even on malformed stdin or config load failure, so a broken adapter never wedges the host's hook pipeline.
- State directory is created `0700`, state files `0600`.
