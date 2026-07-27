# Installation

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

This package is meant to be consumed by another OpenCode project. The primary install method is npm:

- once published: `npm install opencode-cli-dispatch` or `bun add opencode-cli-dispatch`
- pre-publish / development: install from the local tarball built with `npm pack` (see [Building a package](#building-a-package)), or from the git URL

It can also be used as a local plugin file copied/symlinked in (see Option B below).

### Option A — install from npm (or a local tarball before publish)

From the *other* project's directory:

```bash
# once published
bun add opencode-cli-dispatch
# or, before publish, install the local tarball built with npm pack
npm install /path/to/mcpOC/opencode-cli-dispatch-1.0.3.tgz
# or, to depend on it by path instead of copying the tarball into node_modules once:
npm install "file:/path/to/mcpOC/opencode-cli-dispatch-1.0.3.tgz"
```

Then register it in that project's `opencode.json` / `opencode.jsonc`:

```json
{
  "plugin": ["opencode-cli-dispatch"]
}
```

**Important — slash commands are generated automatically.** The `/cc`, `/codex`, and `/opencode` command files are written to `~/.config/opencode/commands/` by default on every plugin load. The `commandsDir` option is only needed if you want a project-local command directory instead. So after installing as an npm dependency, the typical setup is just:

```ts
// other-project/.opencode/plugin/cli-dispatch.ts
import { createCliDispatchPlugin } from "opencode-cli-dispatch"
export default createCliDispatchPlugin()
```

If you prefer project-local commands, point `commandsDir` at the consuming project's own command directory:

```ts
// other-project/.opencode/plugin/cli-dispatch.ts
import { createCliDispatchPlugin } from "opencode-cli-dispatch"
export default createCliDispatchPlugin(undefined, { commandsDir: ".opencode/command" })
```

### Option B — local plugin file (no package install)

Instead of installing via npm, you can also use a local plugin file. OpenCode auto-loads any `.ts`/`.js` file under `.opencode/plugin/` in your project root. Drop a thin wrapper there (this is exactly how this repo dogfoods itself, see [.opencode/plugin/cli-dispatch.ts](../.opencode/plugin/cli-dispatch.ts)), importing straight from this repo's source or `dist/` instead of installing a package at all:

```ts
// .opencode/plugin/cli-dispatch.ts
import { createCliDispatchPlugin } from "opencode-cli-dispatch"

export default createCliDispatchPlugin()
```

`createCliDispatchPlugin(configPath?, options?)` accepts:

- `configPath` — override where the delegate config is loaded from (see below).
- `options.commandsDir` — if set, regenerates the `/{name}` and `/opencode` slash command files into that directory on every plugin load (defaults to `~/.config/opencode/commands/`).

### Option C — install once, globally (all projects)

Both Option A and Option B above are per-project. If you prefer to install the package once and have it available everywhere instead of using npm in each project, OpenCode also has a global config directory, `~/.config/opencode/`, that applies to every project you open — this is where to install if you don't want to repeat the setup per repo. Confirmed against [OpenCode's plugin](https://opencode.ai/docs/plugins/) and [commands](https://opencode.ai/docs/commands/) docs, and cross-checked against `~/.config/opencode/opencode.jsonc` and `~/.config/opencode/plugins/` on a real machine — both are actively used there today (e.g. the `superpowers` plugin is loaded the same way).

**1. Register the plugin globally**, in `~/.config/opencode/opencode.json` or `opencode.jsonc`:

```json
{
  "plugin": ["opencode-cli-dispatch@github:TurboSnails/OpenCodePlugin"]
}
```

OpenCode installs npm/git plugin specs automatically via Bun at startup, caching them under `~/.cache/opencode/`. Because `dist/` is committed to this repo (see [Building a package](#building-a-package)), a plain git checkout is enough — no build step runs, or needs to run, during that install.

Once published to npm, this simplifies to `"plugin": ["opencode-cli-dispatch"]`.

**2. The slash commands are written automatically.** `createCliDispatchPlugin()` writes the generated command files to `~/.config/opencode/commands/` by default on every plugin load, so the global copy step is normally not needed. If you want project-local commands instead, use the `commandsDir` option in a thin wrapper.

**3. Start a fresh session after install/update.** OpenCode loads plugins once at startup, so a resumed session (`--continue`, `--session`, desktop session restore) keeps the old tool snapshot. After changing the plugin or its generated commands, fully quit and start a brand-new session before using `/cc` or `/codex`.

**Config lookup is still per project.** Even with a global install, `cli-dispatch.config.json` is resolved from the project you open (`./cli-dispatch.config.json`, then `./.opencode/...`, then `~/.config/opencode/cli-dispatch.config.json`). With no config file, the plugin uses the built-in `claude` + `codex` defaults.
