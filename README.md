# opencode-cli-dispatch

[中文文档](README_CN.md)

An [OpenCode](https://opencode.ai) plugin that delegates a conversation to an external CLI coding agent (Claude Code, Codex, or any other CLI agent you configure) and streams its response back into the OpenCode chat. Delegation is **sticky on a best-effort basis**: once started, follow-up messages in the session keep being routed to the same delegate until you explicitly exit — but this relies on the model calling the delegate's reply tool, which no hook can force (see [Known limitations](#known-limitations)). An explicit `/<delegate> <message>` command is the reliable way to reach the delegate.

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

## Building a package

`dist/` is committed to this repo (not gitignored) specifically so the package can be installed straight from the git URL — see [Option C](#option-c--install-once-globally-all-projects) — without requiring a build step at install time, since OpenCode's npm/git plugin installer (Bun) does not run `prepare`/`postinstall` scripts by default. **After changing anything under `src/`, rebuild and commit `dist/` in the same change**, or consumers installing from git will keep getting the old compiled output.

This repo is not yet published to a registry, so to install it elsewhere without going through git, ship it as a local tarball:

```bash
bun install          # install dependencies
bun run build         # tsc -> dist/
npm pack              # produces opencode-cli-dispatch-<version>.tgz in the repo root
```

`npm pack` uses the `files` field in `package.json` (`dist/`, `cli-dispatch.config.json`) plus `README.md`/`package.json` to build the tarball — run `npm pack --dry-run` first if you just want to preview its contents without writing the file.

## Installation

This package is meant to be consumed by another OpenCode project, either as an npm dependency (from the tarball built above, or a published registry version) or as a local plugin file copied/symlinked in.

### Option A — install the tarball into another project

From the *other* project's directory:

```bash
npm install /path/to/mcpOC/opencode-cli-dispatch-1.0.0.tgz
# or, to depend on it by path instead of copying the tarball into node_modules once:
npm install "file:/path/to/mcpOC/opencode-cli-dispatch-1.0.0.tgz"
```

(If it's later published to npm, this becomes `npm install opencode-cli-dispatch` / `bun add opencode-cli-dispatch`.)

Then register it in that project's `opencode.json` / `opencode.jsonc`:

```json
{
  "plugin": ["opencode-cli-dispatch"]
}
```

**Important — slash commands are not bundled automatically.** The `/cc`, `/codex`, `/opencode` command files in this repo live under [.opencode/command/](.opencode/command) and are committed by hand; they are *not* included in the npm tarball, and `createCliDispatchPlugin()` only (re)generates them when called with `options.commandsDir`. So after installing as an npm dependency, either:

1. point `commandsDir` at the consuming project's own command directory so they're generated on every plugin load:
   ```ts
   // other-project/.opencode/plugin/cli-dispatch.ts
   import { createCliDispatchPlugin } from "opencode-cli-dispatch"
   export default createCliDispatchPlugin(undefined, { commandsDir: ".opencode/command" })
   ```
2. or manually copy this repo's `.opencode/command/cc.md`, `codex.md`, `opencode.md` into the consuming project's `.opencode/command/`.

### Option B — local plugin file (no package install)

OpenCode auto-loads any `.ts`/`.js` file under `.opencode/plugin/` in your project root. Drop a thin wrapper there (this is exactly how this repo dogfoods itself, see [.opencode/plugin/cli-dispatch.ts](.opencode/plugin/cli-dispatch.ts)), importing straight from this repo's source or `dist/` instead of installing a package at all:

```ts
// .opencode/plugin/cli-dispatch.ts
import { createCliDispatchPlugin } from "opencode-cli-dispatch"

export default createCliDispatchPlugin()
```

`createCliDispatchPlugin(configPath?, options?)` accepts:

- `configPath` — override where the delegate config is loaded from (see below).
- `options.commandsDir` — if set, regenerates the `/{name}` and `/opencode` slash command files into that directory on every plugin load (defaults to the committed files under `.opencode/command/`).

### Option C — install once, globally (all projects)

Both of the options above are per-project. OpenCode also has a global config directory, `~/.config/opencode/`, that applies to every project you open — this is where to install if you don't want to repeat the setup per repo. Confirmed against [OpenCode's plugin](https://opencode.ai/docs/plugins/) and [commands](https://opencode.ai/docs/commands/) docs, and cross-checked against `~/.config/opencode/opencode.jsonc` and `~/.config/opencode/plugins/` on a real machine — both are actively used there today (e.g. the `superpowers` plugin is loaded the same way).

**1. Register the plugin globally**, in `~/.config/opencode/opencode.json` or `opencode.jsonc`:

```json
{
  "plugin": ["opencode-cli-dispatch@github:TurboSnails/OpenCodePlugin"]
}
```

OpenCode installs npm/git plugin specs automatically via Bun at startup, caching them under `~/.cache/opencode/`. Because `dist/` is committed to this repo (see [Building a package](#building-a-package)), a plain git checkout is enough — no build step runs, or needs to run, during that install.

Once published to npm, this simplifies to `"plugin": ["opencode-cli-dispatch"]`.

**2. Get the slash commands globally too.** OpenCode loads markdown command files from `~/.config/opencode/commands/` for every project ([docs](https://opencode.ai/docs/commands/)). Copy this repo's `.opencode/command/cc.md`, `codex.md`, `opencode.md` there:

```bash
mkdir -p ~/.config/opencode/commands
cp .opencode/command/*.md ~/.config/opencode/commands/
```

(There's no way to have `createCliDispatchPlugin`'s `commandsDir` option target this directory automatically from an npm-installed plugin today — it only runs relative to the config passed in at call time. Manual copy is the reliable path until that's wired up.)

**3. Global config still needs a delegate config file.** The `cli-dispatch.config.json` lookup (see [Configuration](#configuration)) is relative to `process.cwd()`, i.e. whichever project you're in — not to `~/.config/opencode/`. With no config file present in a given project, the plugin falls back to its built-in `claude` + `codex` defaults, which is normally fine. If you want custom delegates/args everywhere, drop a `cli-dispatch.config.json` in each project, or pass an absolute `configPath` from a thin local wrapper (Option B) instead of the pure global-npm route.

## Configuration

Delegate behavior is defined in `cli-dispatch.config.json`, resolved (first match wins) from:

1. the `configPath` passed to `createCliDispatchPlugin`, if any
2. `./cli-dispatch.config.json`
3. `./.opencode/cli-dispatch.config.json`
4. `./.opencode/lib/cli-dispatch/config.json`
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

### Verified models

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

This does not, and cannot, guarantee a model calls `{name}_reply` on every sticky follow-up — no hook fires when a model answers with plain text and calls no tool at all. It narrows the failure to "known-bad models are blocked at the door," not "every model is forced to comply."

The gate also covers direct `{name}_start`/`{name}_reply` tool calls (OpenCode `tool.execute.before`, Claude Code `PreToolUse`), closing the bypass where a model calls the tool without going through a slash command. When the current model is unknown (e.g. the first message of a session), both paths fail open: the gate is a guardrail against known-bad models, not a sandbox.

A separate, always-on check rejects a `{name}_start`/`{name}_reply` call whose `prompt` argument contains the whole delegate command template (detected by an internal marker) instead of the user's actual message — this is independent of `verifiedModels` and applies regardless of configuration.

### Config errors and the `cli_dispatch_status` tool

Validation rejects a config when any delegate name doesn't match `/^[\w-]+$/` (letters, digits, underscore, hyphen — anything else would produce invalid tool names), when `binary`/`parser` are missing or invalid, when `startArgs` isn't a string array or doesn't contain the `{prompt}` placeholder (without it the CLI would run with no task), or when `timeoutMs` isn't a positive number. A `replyArgs` without `{externalId}` only logs a warning — a raw delegate with no session concept may legitimately have nothing to resume.

If the config fails to load, the plugin no longer degrades silently: instead of registering nothing, it registers a single `cli_dispatch_status` diagnostic tool. Call it to see the config file path, every validation error, and how to fix them — then edit the config and restart OpenCode to reload the plugin.

### Delegate permissions

Each delegate runs as a separate subprocess with its own permission/sandbox system, controlled entirely by the flags baked into `startArgs`/`replyArgs`.

**Delegates are expected to be configured with write capability.** If a delegate can't edit files, check its flags first, or run the `{name}_check` tool (e.g. `claude_check`) to verify writability in an isolated directory.

#### claude

`--permission-mode <mode>`:

| Mode | Effect |
|---|---|
| `bypassPermissions` | All tool actions allowed without asking (**opt-in escalation** — not the default) |
| `acceptEdits` | File edits auto-accepted; other actions still gated |
| `dontAsk` | Actions requiring permission are **denied without asking** — effectively read-only |
| `plan` | Read-only planning mode |

The built-in `claude` delegate defaults to `acceptEdits`. To restore the previous behavior, set `"--permission-mode", "bypassPermissions"` explicitly in `cli-dispatch.config.json` — this is an opt-in escalation. If no `cli-dispatch.config.json` exists at all, the plugin uses the safe built-in defaults and logs a loud warning telling you where to place the config file.

#### codex

`-c sandbox_mode=<mode>`:

| Mode | Effect |
|---|---|
| `workspace-write` | Can write inside the workspace (default in this package) |
| `read-only` | Cannot write anywhere |

#### Permissions are baked in at spawn time

A delegate session keeps the flags it was started with for its entire lifetime (replies resume the same session). **After editing `cli-dispatch.config.json`, run `/opencode` to exit the active delegation and start a fresh one** — existing delegate sessions do not pick up the new flags.

## Usage

The plugin generates one slash command per configured delegate, named `/<delegate-name>` (e.g. `/claude`, `/codex`). In this repo, `/cc` is an extra hand-maintained alias for `/claude` that lives in [.opencode/command/cc.md](.opencode/command/cc.md) — it is not generated by the plugin. **Note for custom-command authors:** a hand-maintained command is only covered by the verified-models gate when it declares which delegate it drives via a `delegate: <name>` line in its markdown frontmatter (as the plugin-generated commands do); without that declaration the gate cannot associate the command with a delegate.

- `/<delegate-name> <message>` — start (or continue) a delegation to that delegate (e.g. `/claude <message>`, `/codex <message>`, or the `/cc` alias).
- `/opencode` — exit the active delegation for this session; OpenCode answers directly again.

While a delegation is active, subsequent input in that session — plain messages, other slash commands, `@agent` mentions — is forwarded to the active delegate as prompt text on a **best-effort** basis, until `/opencode` is run. This relies on the model calling the delegate's reply tool; a model that answers directly instead is outside the plugin's control (see [Known limitations](#known-limitations)). If a delegate call fails, the error is returned in-chat as a reminder to run `/opencode`; the delegation itself stays active so you can retry or fix the underlying issue.

### Timeout and cancellation

Each delegate run is bounded by a 10-minute timeout by default, overridable per delegate via `timeoutMs` in the config. Cancelling the tool call in OpenCode (Esc) terminates the delegate subprocess immediately and reports `cancelled by user`, which is distinguishable from a timeout or a crash. Termination sends SIGTERM first and escalates to SIGKILL after a 2-second grace period.

Delegate subprocesses run in the session's project directory (the `directory` OpenCode provides in the tool context), which is also the base for the change summary — falling back to the plugin process cwd if no directory is available.

### Known limitations

Some models don't reliably follow the injected sticky-routing system prompt. Verified 2026-07-19: MiniMax-M3 (`minimax-cn` / `minimaxi-cn`) forwards the entire expanded command template as the prompt instead of just the user's arguments (causing the delegate to refuse as a suspected prompt injection), and ignores the sticky routing rule on plain follow-ups, answering directly instead of calling `{name}_reply`. Kimi (`kimi-for-coding/k3`) has been verified to work correctly with this plugin.

This is now mitigated, not just documented: configure [`verifiedModels`](#verified-models) to have the plugin refuse to start a delegation for a model that isn't on the allow-list, and the plugin always rejects a `prompt` argument that is the whole forwarded command template regardless of configuration (see [Verified models](#verified-models)). Neither mechanism can force a model to call `{name}_reply` on a sticky follow-up if it chooses to answer with plain text and call no tool at all — no OpenCode hook fires for that case — so a model still needs to be reasonably instruction-following for the sticky (not just the initial) part of delegation to work.

If multiple `{name}_start` calls run concurrently within the same session, the latest initiated start wins: an earlier start that finishes later will not overwrite the newer delegation.

## Claude Code adapter

Claude Code can also act as a host, delegating to `codex` and `opencode` with the same sticky-routing/verified-models/prompt-sanitization contract — implemented on Claude Code's primitives instead of OpenCode's. An MCP server registers the delegate tools, and `PreToolUse`/`UserPromptSubmit` hooks (short-lived shell processes, configured in `.claude/settings.json`) provide the template sanitization, the sticky routing-rule injection, the verified-models gate, and the `/cc` exit command. This repo dogfoods the adapter; the files below are its working setup:

1. `.mcp.json` registers the `cli-dispatch` MCP server (`bun run src/claude-code-adapter/mcp-server.ts`). The first time Claude Code sees a project-scoped `.mcp.json`, it asks for a **one-time interactive approval** — approve it, or the delegate tools never appear. The hooks deliberately don't depend on the MCP server being up: the `/cc` exit and the verified-models block work even before approval.
2. `.claude/settings.json` registers the two hooks.
3. `.claude/commands/` provides `/codex` and `/opencode` (delegate out) and `/cc` (come home — the same "say the host's own name" convention as OpenCode's `/opencode`).

Configuration lives in `claude-code-adapter.config.json` at the project root (falling back to a built-in codex+opencode default when absent). The `delegates` entries use the exact same shape as the OpenCode [Configuration](#configuration) above. The adapter's `verifiedModels` differs in shape from OpenCode's `provider/model` pairs: Claude Code exposes no provider dimension, so entries are bare model-string patterns (`"claude-sonnet-5"`, `"claude-*"`, `"*"`) — trailing `*` wildcard, case-sensitive, with the same fail-open-when-the-model-is-unknown policy as [Verified models](#verified-models).

Delegation state (active delegate, external session id) is persisted as one small JSON file per Claude Code session under the OS temp dir (`cli-dispatch-claude-code/`), because each hook invocation is a separate process; the current model is not persisted — it is read fresh from the session transcript on every check.

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
