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

**Important — slash commands are not bundled automatically.** The `/cc`, `/codex`, `/opencode` command files in this repo live under [.opencode/command/](../.opencode/command) and are committed by hand; they are *not* included in the npm tarball, and `createCliDispatchPlugin()` only (re)generates them when called with `options.commandsDir`. So after installing as an npm dependency, either:

1. point `commandsDir` at the consuming project's own command directory so they're generated on every plugin load:
   ```ts
   // other-project/.opencode/plugin/cli-dispatch.ts
   import { createCliDispatchPlugin } from "opencode-cli-dispatch"
   export default createCliDispatchPlugin(undefined, { commandsDir: ".opencode/command" })
   ```
2. or manually copy this repo's `.opencode/command/cc.md`, `codex.md`, `opencode.md` into the consuming project's `.opencode/command/`.

### Option B — local plugin file (no package install)

OpenCode auto-loads any `.ts`/`.js` file under `.opencode/plugin/` in your project root. Drop a thin wrapper there (this is exactly how this repo dogfoods itself, see [.opencode/plugin/cli-dispatch.ts](../.opencode/plugin/cli-dispatch.ts)), importing straight from this repo's source or `dist/` instead of installing a package at all:

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

**2. Get the slash commands globally too.** OpenCode loads markdown command files from `~/.config/opencode/commands/` for every project ([docs](https://opencode.ai/docs/commands/)). Copy this repo's `.opencode/command/*.md` there:

```bash
mkdir -p ~/.config/opencode/commands
cp .opencode/command/*.md ~/.config/opencode/commands/
```

(There's no way to have `createCliDispatchPlugin`'s `commandsDir` option target this directory automatically from an npm-installed plugin today — it only runs relative to the config passed in at call time. Manual copy is the reliable path until that's wired up.)

**3. Global config still needs a delegate config file.** The `cli-dispatch.config.json` lookup (see [Configuration](configuration.md#configuration)) is relative to `process.cwd()`, i.e. whichever project you're in — not to `~/.config/opencode/`. With no config file present in a given project, the plugin falls back to its built-in `claude` + `codex` defaults, which is normally fine. If you want custom delegates/args everywhere, drop a `cli-dispatch.config.json` in each project, or pass an absolute `configPath` from a thin local wrapper (Option B) instead of the pure global-npm route.
