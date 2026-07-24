# Configuration

Delegate behavior is defined in `cli-dispatch.config.json`, resolved (first match wins) from:

If `configPath` is passed to `createCliDispatchPlugin()`, that path is used exclusively.
Otherwise, the plugin checks in order:

1. `./cli-dispatch.config.json`
2. `./.opencode/cli-dispatch.config.json`
3. `./.opencode/lib/cli-dispatch/config.json`
4. `~/.config/opencode/cli-dispatch.config.json`
5. a built-in default (the `claude` + `codex` presets shown below) if none of the above exist

```json
{
  "delegates": {
    "claude": {
      "binary": "claude",
      "parser": "claude",
      "startArgs": [
        "-p", "--output-format", "stream-json", "--verbose",
        "--permission-mode", "acceptEdits",
        "--session-id", "{sessionId}",
        "--", "{prompt}"
      ],
      "replyArgs": [
        "-p", "--output-format", "stream-json", "--verbose",
        "--permission-mode", "acceptEdits",
        "--resume", "{externalId}",
        "--", "{prompt}"
      ]
    },
    "codex": {
      "binary": "codex",
      "parser": "codex",
      "startArgs": ["exec", "--json", "-c", "sandbox_mode=workspace-write", "--skip-git-repo-check", "--", "{prompt}"],
      "replyArgs": ["exec", "resume", "{externalId}", "--json", "-c", "sandbox_mode=workspace-write", "--skip-git-repo-check", "--", "{prompt}"]
    }
  }
}
```

Each delegate entry:

| Field | Meaning |
|---|---|
| `binary` | Executable to spawn (must be on `PATH`, or an absolute path). |
| `parser` | `"claude"`, `"codex"`, `"opencode"`, or `"raw"` — selects how stdout events are parsed into progress updates and a final response. `"opencode"` parses `opencode run --format json` output (session id from the `sessionID` field present on every line; final text accumulated from `text` events). With `raw`, the final response is all stdout lines joined by newlines, in order (not just the last line). |
| `startArgs` | Argv template for the first turn. Placeholders: `{prompt}`, `{sessionId}`. |
| `replyArgs` | Argv template for follow-up turns. Placeholders: `{prompt}`, `{externalId}` (the session id the delegate itself returned on start). |
| `timeoutMs` | Optional. Per-run timeout in milliseconds, overriding the default 10-minute timeout (see [Timeout and cancellation](#timeout-and-cancellation)). Must be a positive number — anything else fails config validation. |

Adding a new delegate is just adding another entry — a `/{name}` command, and `{name}_start` / `{name}_reply` / `{name}_check` tools, are generated automatically for every key under `delegates`.

## Verified models

Sticky delegation and prompt forwarding rely on the model itself following instructions injected via system prompt and command text — there is no OpenCode mechanism that forces a model to call a specific tool (see [Known limitations](#known-limitations)). Some models don't follow this contract; an optional top-level `verifiedModels` allow-list lets the plugin refuse to start a delegation for a model that hasn't been confirmed to work, instead of silently misbehaving:

```json
{
  "delegates": { "...": "..." },
  "verifiedModels": ["anthropic/*", "moonshotai/kimi-for-coding-k3"]
}
```

Each entry is a `provider/model` string; either segment may end in a trailing `*` wildcard (`anthropic/*` matches every Anthropic model; `*/k3` matches `k3` on any provider). Matching is case-sensitive and exact otherwise — no other glob syntax is supported.

- **Omitted or empty**: no restriction — every model may start a delegation. This is the default; existing configs need no changes.
- **Configured and non-empty**: when a user issues a delegate-start command (e.g. `/claude`, `/cc`) and the session's current model matches no entry, the plugin blocks the command before `{name}_start` is ever called and returns a message naming the model instead.
- **Unknown model**: OpenCode only reports the active model on `chat.message`, which fires *after* `command.execute.before` for a session's very first message ever sent — so on that first command the model is not yet known to the plugin. This case fails open (the command proceeds) rather than blocking every brand-new session; the gate applies starting with that session's second delegate-start command onward.

This does not, and cannot, guarantee a model calls `{name}_reply` on every sticky follow-up — no OpenCode hook fires when a model answers with plain text and calls no tool at all. It narrows the failure to "known-bad models are blocked at the door," not "every model is forced to comply."

The gate also covers direct `{name}_start`/`{name}_reply` tool calls (OpenCode `tool.execute.before`, Claude Code `PreToolUse`), closing the bypass where a model calls the tool without going through a slash command. When the current model is unknown (e.g. the first message of a session), both paths fail open: the gate is a guardrail against known-bad models, not a sandbox.

A separate, always-on check rejects a `{name}_start`/`{name}_reply` call whose `prompt` argument contains the whole delegate command template (detected by an internal marker) instead of the user's actual message — this is independent of `verifiedModels` and applies regardless of configuration.

## Config errors and the `cli_dispatch_status` tool

Validation rejects a config when any delegate name doesn't match `/^[\w-]+$/` (letters, digits, underscore, hyphen — anything else would produce invalid tool names), when `binary`/`parser` are missing or invalid, when `startArgs` isn't a string array or doesn't contain the `{prompt}` placeholder (without it the CLI would run with no task), or when `timeoutMs` isn't a positive number. A `replyArgs` without `{externalId}` only logs a warning — a raw delegate with no session concept may legitimately have nothing to resume.

If the config fails to load, the plugin no longer degrades silently: instead of registering nothing, it registers `cli_dispatch_status` and `cli_dispatch_doctor` diagnostic tools. Call `cli_dispatch_status` to see the config file path, every validation error, and how to fix them — then edit the config and restart OpenCode to reload the plugin.

## Delegate permissions

Each delegate runs as a separate subprocess with its own permission/sandbox system, controlled entirely by the flags baked into `startArgs`/`replyArgs`.

**Delegates are expected to be configured with write capability.** If a delegate can't edit files, check its flags first, or run the `{name}_check` tool (e.g. `claude_check`) to verify writability in an isolated directory.

### claude

`--permission-mode <mode>`:

| Mode | Effect |
|---|---|
| `bypassPermissions` | All tool actions allowed without asking (**opt-in escalation** — not the default) |
| `acceptEdits` | File edits auto-accepted; other actions still gated |
| `dontAsk` | Actions requiring permission are **denied without asking** — effectively read-only |
| `plan` | Read-only planning mode |

The built-in `claude` delegate defaults to `acceptEdits`. To restore the previous behavior, set `"--permission-mode", "bypassPermissions"` explicitly in `cli-dispatch.config.json` — this is an opt-in escalation. If no `cli-dispatch.config.json` exists at all, the plugin uses the safe built-in defaults and logs a loud warning telling you where to place the config file.

### codex

`-c sandbox_mode=<mode>`:

| Mode | Effect |
|---|---|
| `workspace-write` | Can write inside the workspace (default in this package) |
| `read-only` | Cannot write anywhere |

### Permissions are baked in at spawn time

A delegate session keeps the flags it was started with for its entire lifetime (replies resume the same session). **After editing `cli-dispatch.config.json`, run `/opencode` to exit the active delegation and start a fresh one** — existing delegate sessions do not pick up the new flags.

## Usage

The plugin generates one slash command per configured delegate, named `/<delegate-name>` (e.g. `/claude`, `/codex`). When a `claude` delegate is configured, the plugin also generates `/cc` as an alias for `/claude`. The committed [.opencode/command/cc.md](../.opencode/command/cc.md) is a fallback for environments where plugin-generated commands cannot be written; it is no longer the only source of `/cc`. **Note for custom-command authors:** a hand-maintained command is only covered by the verified-models gate when it declares which delegate it drives via a `delegate: <name>` line in its markdown frontmatter (as the plugin-generated commands do); without that declaration the gate cannot associate the command with a delegate.

- `/<delegate-name> <message>` — start (or continue) a delegation to that delegate (e.g. `/claude <message>`, `/codex <message>`, or the `/cc` alias).
- `/opencode` — exit the active delegation for this session; OpenCode answers directly again.

While a delegation is active, subsequent input in that session — plain messages, other slash commands, `@agent` mentions — is forwarded to the active delegate as prompt text on a **best-effort** basis, until `/opencode` is run. This relies on the model calling the delegate's reply tool; the plugin cannot force that call, but it does detect a turn that didn't make it and disconnects the delegation with a visible notice rather than leaving it silently active (see [Known limitations](#known-limitations)). If a delegate call fails, the error is returned in-chat as a reminder to run `/opencode`; the delegation itself stays active so you can retry or fix the underlying issue.

### Timeout and cancellation

Each delegate run is bounded by a 10-minute timeout by default, overridable per delegate via `timeoutMs` in the config. Cancelling the tool call in OpenCode (Esc) terminates the delegate subprocess immediately and reports `cancelled by user`, which is distinguishable from a timeout or a crash. Termination sends SIGTERM first and escalates to SIGKILL after a 2-second grace period.

Delegate subprocesses run in the session's project directory (the `directory` OpenCode provides in the tool context), which is also the base for the change summary — falling back to the plugin process cwd if no directory is available.

## Slash commands and `commandsDir`

By default, the plugin writes generated slash-command files (`/cc`, `/claude`, `/codex`, `/opencode`) to `~/.config/opencode/commands/` on every load. You can override this with the `commandsDir` option passed to `createCliDispatchPlugin()`:

```ts
export default createCliDispatchPlugin(undefined, { commandsDir: ".opencode/command" })
```

**Limitation:** `cli_dispatch_doctor` and `cli-dispatch doctor --fix` currently target the default global commands directory only (`~/.config/opencode/commands/`). If you set a project-local `commandsDir`, the doctor check will not inspect or regenerate that directory; you should manage those command files manually.

## Known limitations

Some models don't reliably follow the injected sticky-routing system prompt. Verified 2026-07-19: MiniMax-M3 (`minimax-cn` / `minimaxi-cn`) forwards the entire expanded command template as the prompt instead of just the user's arguments (causing the delegate to refuse as a suspected prompt injection), and ignores the sticky routing rule on plain follow-ups, answering directly instead of calling `{name}_reply`. Kimi (`kimi-for-coding/k3`) has been verified to work correctly with this plugin.

This is now mitigated, not just documented: configure [`verifiedModels`](#verified-models) to have the plugin refuse to start a delegation for a model that isn't on the allow-list, and the plugin always rejects a `prompt` argument that is the whole forwarded command template regardless of configuration (see [Verified models](#verified-models)). Neither mechanism can force a model to call `{name}_reply` on a sticky follow-up if it chooses to answer with plain text and call no tool at all — no hook can force a tool call — so a model still needs to be reasonably instruction-following for the sticky (not just the initial) part of delegation to work.

What the plugin *can* do is detect the failure after it happens instead of leaving it silent: on OpenCode's `session.idle` event, it checks whether the turn that just ended called any configured delegate's `{name}_start`/`{name}_reply` tool. If it didn't — and the turn wasn't a user-initiated abort — the plugin clears the active delegation and posts a visible notice naming the `/<delegate-name>` command needed to resume, instead of leaving sticky routing marked active while quietly no longer working. This is still one turn late: the model's direct answer has already been shown by the time the notice appears, and the mechanism cannot prevent that answer or force the next turn to comply — it only stops a single silent miss from becoming a string of them.

If multiple `{name}_start` calls run concurrently within the same session, the latest initiated start wins: an earlier start that finishes later will not overwrite the newer delegation.
