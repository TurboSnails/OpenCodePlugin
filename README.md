# opencode-cli-dispatch

[中文文档](README_CN.md)

An [OpenCode](https://opencode.ai) plugin that delegates a conversation to an external CLI coding agent (Claude Code, Codex, or any other CLI agent you configure) and streams its response back into the OpenCode chat. Delegation is **sticky**: once started, every follow-up message in the session keeps going to the same delegate until you explicitly exit.

## Features

- **Multi-delegate**: any number of CLI agents can be configured side by side (ships with `claude` and `codex` presets).
- **Sticky routing**: after `/cc` or `/codex`, all subsequent messages — including plain text and other slash commands — are forwarded to the active delegate until `/opencode` is run.
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
        "--permission-mode", "bypassPermissions",
        "--session-id", "{sessionId}",
        "--", "{prompt}"
      ],
      "replyArgs": [
        "-p", "--output-format", "stream-json", "--verbose",
        "--permission-mode", "bypassPermissions",
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
| `parser` | `"claude"`, `"codex"`, or `"raw"` — selects how stdout events are parsed into progress updates and a final response. With `raw`, the final response is all stdout lines joined by newlines, in order (not just the last line). |
| `startArgs` | Argv template for the first turn. Placeholders: `{prompt}`, `{sessionId}`. |
| `replyArgs` | Argv template for follow-up turns. Placeholders: `{prompt}`, `{externalId}` (the session id the delegate itself returned on start). |
| `timeoutMs` | Optional. Per-run timeout in milliseconds, overriding the default 10-minute timeout (see [Timeout and cancellation](#timeout-and-cancellation)). Must be a positive number — anything else fails config validation. |

Adding a new delegate is just adding another entry — a `/{name}` command, and `{name}_start` / `{name}_reply` / `{name}_check` tools, are generated automatically for every key under `delegates`.

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
| `bypassPermissions` | All tool actions allowed without asking (default in this package) |
| `acceptEdits` | File edits auto-accepted; other actions still gated |
| `dontAsk` | Actions requiring permission are **denied without asking** — effectively read-only |
| `plan` | Read-only planning mode |

#### codex

`-c sandbox_mode=<mode>`:

| Mode | Effect |
|---|---|
| `workspace-write` | Can write inside the workspace (default in this package) |
| `read-only` | Cannot write anywhere |

#### Permissions are baked in at spawn time

A delegate session keeps the flags it was started with for its entire lifetime (replies resume the same session). **After editing `cli-dispatch.config.json`, run `/opencode` to exit the active delegation and start a fresh one** — existing delegate sessions do not pick up the new flags.

## Usage

The plugin generates one slash command per configured delegate, named `/<delegate-name>` (e.g. `/claude`, `/codex`). In this repo, `/cc` is an extra hand-maintained alias for `/claude` that lives in [.opencode/command/cc.md](.opencode/command/cc.md) — it is not generated by the plugin.

- `/<delegate-name> <message>` — start (or continue) a delegation to that delegate (e.g. `/claude <message>`, `/codex <message>`, or the `/cc` alias).
- `/opencode` — exit the active delegation for this session; OpenCode answers directly again.

While a delegation is active, **all** subsequent input in that session — plain messages, other slash commands, `@agent` mentions — is forwarded to the active delegate as prompt text, until `/opencode` is run. If a delegate call fails, the error is returned in-chat as a reminder to run `/opencode`; the delegation itself stays active so you can retry or fix the underlying issue.

### Timeout and cancellation

Each delegate run is bounded by a 10-minute timeout by default, overridable per delegate via `timeoutMs` in the config. Cancelling the tool call in OpenCode (Esc) terminates the delegate subprocess immediately and reports `cancelled by user`, which is distinguishable from a timeout or a crash. Termination sends SIGTERM first and escalates to SIGKILL after a 2-second grace period.

Delegate subprocesses run in the session's project directory (the `directory` OpenCode provides in the tool context), which is also the base for the change summary — falling back to the plugin process cwd if no directory is available.

### Known limitations

Some models don't reliably follow the injected sticky-routing system prompt. Verified 2026-07-19: MiniMax-M3 (`minimax-cn` / `minimaxi-cn`) forwards the entire expanded command template as the prompt instead of just the user's arguments (causing the delegate to refuse as a suspected prompt injection), and ignores the sticky routing rule on plain follow-ups, answering directly instead of calling `{name}_reply`. Kimi (`kimi-for-coding/k3`) has been verified to work correctly with this plugin.

If multiple `{name}_start` calls run concurrently within the same session, the latest initiated start wins: an earlier start that finishes later will not overwrite the newer delegation.

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
| [src/parse-events.ts](src/parse-events.ts) | Per-CLI stdout event parsers (`claude`, `codex`, `raw`). |
| [src/session-store.ts](src/session-store.ts) | In-memory per-OpenCode-session delegate/agent state. |

## License

MIT
