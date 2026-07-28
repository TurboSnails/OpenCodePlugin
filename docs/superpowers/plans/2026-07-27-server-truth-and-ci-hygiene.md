# server-truth diagnostics + CI hygiene Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make duplicate/env diagnosis prefer evidence written by the OpenCode server process at plugin-load time, and move the core test matrix into CI with a changelog.

**Architecture:** The plugin writes a per-project load manifest under `~/.local/share/opencode/cli-dispatch/` whenever it loads (success or degraded config). Doctor reads a fresh manifest (cwd match + live pid) to learn the server process's `CLI_DISPATCH_DEV` truth, falling back to the doctor process env when no fresh manifest exists. A separate task adds GitHub Actions CI, `CHANGELOG.md`, and fixes the stale tarball version in installation docs.

**Tech Stack:** Bun, TypeScript, OpenCode plugin API, bun:test, GitHub Actions.

## Global Constraints

- `dist/` is committed; every `src/` change must be followed by `bun run build` and the `dist/` output must be included in the same commit.
- Do not change delegate spawn flags, verifiedModels semantics, or sticky routing.
- Manifest writes must never block plugin loading; failures are `console.warn` only.
- Tests must run with `bun test`, `bun run test:dev`, and `bun run test:isolated` from the repo root.
- Final release for this work is `1.3.0`.

---

### Task 1: Server load manifest writer/reader

**Files:**
- Create: `src/load-manifest.ts`
- Modify: `src/index.ts:1-69`
- Test: `src/__tests__/load-manifest.test.ts`
- Test: `src/__tests__/index.test.ts`

**Interfaces:**
- Consumes: `CliDispatchConfig` from `src/config.ts`; `Plugin` / `Hooks` / `PluginInput` from `@opencode-ai/plugin`.
- Produces:
  - `interface LoadManifest { version: string; pid: number; cwd: string; loadedAt: string; cliDispatchDev: boolean; configPath?: string; delegates: string[]; tools: string[]; commandsDir: string }`
  - `interface LoadManifestContext { cwd: string; homeDir: string }`
  - `writeLoadManifest(input: { config: CliDispatchConfig; tools: string[]; commandsDir: string; configPath?: string; cwd?: string; homeDir?: string }): LoadManifest`
  - `readLoadManifest(ctx: LoadManifestContext): LoadManifest | undefined`
  - `isManifestFresh(manifest: LoadManifest | undefined, ctx: LoadManifestContext): manifest is LoadManifest`
  - `manifestPath(cwd: string, homeDir?: string): string`

- [ ] **Step 1: Write the failing tests**

Create `src/__tests__/load-manifest.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, statSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"
import {
  writeLoadManifest,
  readLoadManifest,
  isManifestFresh,
  manifestPath,
  type LoadManifest,
} from "../load-manifest"
import type { CliDispatchConfig } from "../config"

let root: string
let home: string
let cwd: string
let originalDev: string | undefined

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "cli-dispatch-manifest-test-"))
  home = join(root, "home")
  cwd = join(root, "cwd")
  originalDev = process.env.CLI_DISPATCH_DEV
})

afterEach(() => {
  if (originalDev === undefined) delete process.env.CLI_DISPATCH_DEV
  else process.env.CLI_DISPATCH_DEV = originalDev
  rmSync(root, { recursive: true, force: true })
})

function config(): CliDispatchConfig {
  return {
    delegates: {
      claude: { binary: "claude", parser: "claude", startArgs: ["{prompt}"], replyArgs: ["{prompt}"] },
    },
  }
}

describe("load manifest", () => {
  it("writes and reads a fresh manifest with server env truth", () => {
    process.env.CLI_DISPATCH_DEV = "1"
    const written = writeLoadManifest({
      config: config(),
      tools: ["claude_start", "cli_dispatch_doctor"],
      commandsDir: join(home, ".config", "opencode", "commands"),
      configPath: join(cwd, "cli-dispatch.config.json"),
      cwd,
      homeDir: home,
    })

    const path = manifestPath(cwd, home)
    expect(existsSync(path)).toBe(true)
    expect(statSync(path).mode & 0o777).toBe(0o600)
    expect(written.cliDispatchDev).toBe(true)

    const read = readLoadManifest({ cwd, homeDir: home })
    expect(read).toEqual(written)
    expect(isManifestFresh(read, { cwd, homeDir: home })).toBe(true)
  })

  it("treats a manifest with a dead pid as stale", () => {
    const manifest = writeLoadManifest({
      config: config(),
      tools: ["claude_start"],
      commandsDir: join(home, "commands"),
      cwd,
      homeDir: home,
    })
    const stale: LoadManifest = { ...manifest, pid: 99999999 }

    expect(isManifestFresh(stale, { cwd, homeDir: home })).toBe(false)
  })

  it("returns undefined for missing, wrong-cwd, or malformed manifests", () => {
    expect(readLoadManifest({ cwd, homeDir: home })).toBeUndefined()

    const other = writeLoadManifest({
      config: config(),
      tools: ["claude_start"],
      commandsDir: join(home, "commands"),
      cwd: join(root, "other"),
      homeDir: home,
    })
    expect(readLoadManifest({ cwd, homeDir: home })).toBeUndefined()
    expect(isManifestFresh(other, { cwd, homeDir: home })).toBe(false)

    writeFileSync(manifestPath(cwd, home), "{ not json")
    expect(readLoadManifest({ cwd, homeDir: home })).toBeUndefined()
  })

  it("throws when the manifest dir cannot be created", () => {
    const fileHome = join(root, "file-home")
    writeFileSync(fileHome, "not a dir")
    expect(() =>
      writeLoadManifest({
        config: config(),
        tools: ["claude_start"],
        commandsDir: join(root, "commands"),
        cwd,
        homeDir: fileHome,
      }),
    ).toThrow()
  })
})
```

Add this test to `src/__tests__/index.test.ts`:

```ts
  it("warns but still loads when writing the load manifest fails", async () => {
    const badHome = join(TEST_DIR, "bad-home")
    writeFileSync(badHome, "not a dir")
    const configPath = join(TEST_DIR, "config.json")
    writeFileSync(
      configPath,
      JSON.stringify({
        delegates: {
          myagent: { binary: "myagent", parser: "raw", startArgs: ["{prompt}"], replyArgs: ["{prompt}"] },
        },
      }),
    )

    const realOs = await import("os")
    const warn = spyOn(console, "warn").mockImplementation(() => {})
    mock.module("os", () => ({ ...realOs, homedir: () => badHome }))
    try {
      const hooks = await createCliDispatchPlugin(configPath, { commandsDir: join(TEST_DIR, "commands") })({} as any)
      expect(Object.keys(hooks.tool!)).toContain("myagent_start")
      expect(warn).toHaveBeenCalled()
    } finally {
      warn.mockRestore()
      mock.restore()
    }
  })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test src/__tests__/load-manifest.test.ts src/__tests__/index.test.ts`
Expected: FAIL with `Cannot find module "../load-manifest"`.

- [ ] **Step 3: Implement `src/load-manifest.ts`**

```ts
import { createHash } from "crypto"
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "fs"
import { homedir } from "os"
import { join } from "path"
import { fileURLToPath } from "url"
import type { CliDispatchConfig } from "./config"

export interface LoadManifest {
  version: string
  pid: number
  cwd: string
  loadedAt: string
  cliDispatchDev: boolean
  configPath?: string
  delegates: string[]
  tools: string[]
  commandsDir: string
}

export interface LoadManifestContext {
  cwd: string
  homeDir: string
}

export function manifestDir(homeDir: string = homedir()): string {
  return join(homeDir, ".local", "share", "opencode", "cli-dispatch")
}

export function manifestPath(cwd: string, homeDir: string = homedir()): string {
  const hash = createHash("sha1").update(cwd).digest("hex").slice(0, 12)
  return join(manifestDir(homeDir), `loaded-${hash}.json`)
}

function ownVersion(): string {
  const pkg = JSON.parse(readFileSync(fileURLToPath(new URL("../package.json", import.meta.url)), "utf-8"))
  return pkg.version
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    return (err as NodeJS.ErrnoException)?.code === "EPERM"
  }
}

export function writeLoadManifest(input: {
  config: CliDispatchConfig
  tools: string[]
  commandsDir: string
  configPath?: string
  cwd?: string
  homeDir?: string
}): LoadManifest {
  const cwd = input.cwd ?? process.cwd()
  const homeDir = input.homeDir ?? homedir()
  const manifest: LoadManifest = {
    version: ownVersion(),
    pid: process.pid,
    cwd,
    loadedAt: new Date().toISOString(),
    cliDispatchDev: process.env.CLI_DISPATCH_DEV === "1",
    configPath: input.configPath,
    delegates: Object.keys(input.config.delegates),
    tools: input.tools,
    commandsDir: input.commandsDir,
  }

  const dir = manifestDir(homeDir)
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  chmodSync(dir, 0o700)
  const path = manifestPath(cwd, homeDir)
  const tmp = `${path}.tmp`
  writeFileSync(tmp, JSON.stringify(manifest, null, 2) + "\n", { encoding: "utf-8", mode: 0o600 })
  chmodSync(tmp, 0o600)
  renameSync(tmp, path)
  return manifest
}

export function readLoadManifest(ctx: LoadManifestContext): LoadManifest | undefined {
  const path = manifestPath(ctx.cwd, ctx.homeDir)
  if (!existsSync(path)) return undefined
  try {
    const parsed = JSON.parse(readFileSync(path, "utf-8")) as LoadManifest
    if (parsed.cwd !== ctx.cwd || typeof parsed.pid !== "number" || typeof parsed.cliDispatchDev !== "boolean") {
      return undefined
    }
    return parsed
  } catch {
    return undefined
  }
}

export function isManifestFresh(manifest: LoadManifest | undefined, ctx: LoadManifestContext): manifest is LoadManifest {
  if (!manifest || manifest.cwd !== ctx.cwd) return false
  return pidAlive(manifest.pid)
}
```

- [ ] **Step 4: Wire manifest writing into `src/index.ts`**

Add the import:

```ts
import { writeLoadManifest } from "./load-manifest"
```

In `createCliDispatchPlugin`, move `commandsDir` above the `try` and write the manifest in both paths:

```ts
export function createCliDispatchPlugin(configPath?: string, options?: { commandsDir?: string }): Plugin {
  return async (input: PluginInput) => {
    let tools: NonNullable<Hooks["tool"]>
    let config: CliDispatchConfig
    const commandsDir = options?.commandsDir ?? join(homedir(), ".config", "opencode", "commands")

    try {
      config = loadConfig(configPath)

      try {
        generateCommands(config, commandsDir)
      } catch (err) {
        console.warn(
          `[cli-dispatch] could not write slash commands to ${commandsDir}: ${err instanceof Error ? err.message : String(err)}. ` +
            `Run "cli-dispatch doctor" later to diagnose.`,
        )
      }

      tools = {
        ...Object.fromEntries(
          Object.entries(config.delegates).flatMap(([name, cfg]) => [
            [`${name}_start`, makeStartTool(name, cfg)],
            [`${name}_reply`, makeReplyTool(name, cfg)],
            [`${name}_check`, makeCheckTool(name, cfg)],
          ]),
        ),
        cli_dispatch_doctor: makeDoctorTool(),
      }
    } catch (err) {
      console.error("[cli-dispatch] Failed to load config:", err)
      config = { delegates: {} }
      tools = { cli_dispatch_status: makeStatusTool(err), cli_dispatch_doctor: makeDoctorTool() }
    }

    try {
      writeLoadManifest({ config, tools: Object.keys(tools), commandsDir, configPath })
    } catch (err) {
      console.warn(`[cli-dispatch] could not write load manifest: ${err instanceof Error ? err.message : String(err)}`)
    }

    return {
      tool: tools,
      "experimental.chat.system.transform": makeSystemTransform(),
      "chat.message": makeChatMessage(),
      "command.execute.before": makeCommandBefore(config),
      "tool.execute.before": makeToolExecuteBefore(config),
      event: makeSessionIdle(config, input.client),
    }
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `bun test src/__tests__/load-manifest.test.ts src/__tests__/index.test.ts`
Expected: PASS.

- [ ] **Step 6: Build and commit**

Run:

```bash
bun run build
git add src/load-manifest.ts src/index.ts src/__tests__/load-manifest.test.ts src/__tests__/index.test.ts dist
git commit -m "feat: write server load manifest for cli-dispatch diagnostics"
```

Expected: commit succeeds.

---

### Task 2: Doctor reads fresh server manifest for duplicate/env truth

**Files:**
- Modify: `src/doctor/env-checks.ts:44-113`
- Modify: `src/doctor/checks.ts:9-55`
- Test: `src/__tests__/doctor-checks.test.ts`

**Interfaces:**
- Consumes: `LoadManifest`, `readLoadManifest`, `isManifestFresh` from Task 1.
- Produces:
  - `checkServerLoadManifest(ctx: DoctorContext): CheckResult`
  - Updated `checkDuplicatePluginRegistration(ctx)` whose dev-gated wrapper activity uses fresh server manifest when available.
  - New check id `server-load-manifest`, inserted after `duplicate-plugin-registration`.

- [ ] **Step 1: Write the failing tests**

In `src/__tests__/doctor-checks.test.ts`, update the dev-gated duplicate tests to write a manifest and assert the source:

```ts
  it("uses a fresh server manifest over the doctor process env for dev-gated wrappers", async () => {
    delete process.env.CLI_DISPATCH_DEV
    mkdirSync(join(home, ".config", "opencode"), { recursive: true })
    writeFileSync(
      join(home, ".config", "opencode", "opencode.json"),
      JSON.stringify({ plugin: ["opencode-cli-dispatch@git+https://github.com/TurboSnails/OpenCodePlugin.git"] }),
    )
    mkdirSync(join(cwd, ".opencode", "plugin"), { recursive: true })
    writeFileSync(
      join(cwd, ".opencode", "plugin", "cli-dispatch.ts"),
      'import { createLocalCliDispatchPlugin } from "../../src/local-plugin"\n\nexport default createLocalCliDispatchPlugin()\n',
    )
    const { writeLoadManifest } = await import("../load-manifest")
    writeLoadManifest({
      config: { delegates: {} },
      tools: ["claude_start"],
      commandsDir: join(home, ".config", "opencode", "commands"),
      cwd,
      homeDir: home,
    })
    process.env.CLI_DISPATCH_DEV = "delete-me"
    delete process.env.CLI_DISPATCH_DEV

    const results = await run(ctx())
    const check = byId(results, "duplicate-plugin-registration")
    expect(check.ok).toBe(false)
    expect(check.detail).toContain("server manifest")
  })
```

Update the existing unset test to assert fallback source when no manifest exists:

```ts
    const check = byId(results, "duplicate-plugin-registration")
    expect(check.ok).toBe(true)
    expect(check.detail).toContain("doctor process env")
```

Replace the fixed-order test with ten checks:

```ts
    expect(results.map((r) => r.id)).toEqual([
      "plugin-registered",
      "duplicate-plugin-registration",
      "server-load-manifest",
      "config-file",
      "plugin-tools",
      "opencode-compat",
      "delegate-binaries",
      "cli-authenticated",
      "writability-probe",
      "slash-commands",
    ])
```

Add a stale-manifest fallback test:

```ts
  it("falls back to the doctor process env when the server manifest is stale", async () => {
    delete process.env.CLI_DISPATCH_DEV
    mkdirSync(join(home, ".config", "opencode"), { recursive: true })
    writeFileSync(
      join(home, ".config", "opencode", "opencode.json"),
      JSON.stringify({ plugin: ["opencode-cli-dispatch@git+https://github.com/TurboSnails/OpenCodePlugin.git"] }),
    )
    mkdirSync(join(cwd, ".opencode", "plugin"), { recursive: true })
    writeFileSync(
      join(cwd, ".opencode", "plugin", "cli-dispatch.ts"),
      'import { createLocalCliDispatchPlugin } from "../../src/local-plugin"\n\nexport default createLocalCliDispatchPlugin()\n',
    )
    const { manifestPath } = await import("../load-manifest")
    mkdirSync(join(home, ".local", "share", "opencode", "cli-dispatch"), { recursive: true })
    writeFileSync(
      manifestPath(cwd, home),
      JSON.stringify({ version: "0.0.0", pid: 99999999, cwd, loadedAt: new Date().toISOString(), cliDispatchDev: true, delegates: [], tools: [], commandsDir: "" }),
    )

    const results = await run(ctx())
    expect(byId(results, "duplicate-plugin-registration").detail).toContain("doctor process env")
    expect(byId(results, "server-load-manifest").detail).toContain("doctor process env")
  })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test src/__tests__/doctor-checks.test.ts`
Expected: FAIL because `server-load-manifest` is missing and duplicate detail has no source.

- [ ] **Step 3: Implement doctor manifest reading**

In `src/doctor/env-checks.ts`, add the import:

```ts
import { readLoadManifest, isManifestFresh } from "../load-manifest"
```

Replace `wrapperIsActive` and `checkDuplicatePluginRegistration`, and add `checkServerLoadManifest`:

```ts
function wrapperIsDevGated(text: string): boolean {
  return text.includes("CLI_DISPATCH_DEV") || text.includes("createLocalCliDispatchPlugin")
}

function wrapperIsActive(text: string, serverCliDispatchDev?: boolean): boolean {
  if (!wrapperIsDevGated(text)) return true
  return serverCliDispatchDev ?? process.env.CLI_DISPATCH_DEV === "1"
}

function isCliDispatchWrapper(text: string): boolean {
  return (
    text.includes(PKG) ||
    text.includes("createCliDispatchPlugin") ||
    text.includes("createLocalCliDispatchPlugin")
  )
}

function devGateSource(ctx: DoctorContext): { serverCliDispatchDev?: boolean; source: string } {
  const manifest = readLoadManifest({ cwd: ctx.cwd, homeDir: ctx.homeDir })
  if (isManifestFresh(manifest, { cwd: ctx.cwd, homeDir: ctx.homeDir })) {
    return { serverCliDispatchDev: manifest.cliDispatchDev, source: `server manifest (cliDispatchDev=${manifest.cliDispatchDev})` }
  }
  const doctorDev = process.env.CLI_DISPATCH_DEV === "1"
  return { source: `doctor process env (CLI_DISPATCH_DEV=${doctorDev})` }
}

export function checkServerLoadManifest(ctx: DoctorContext): CheckResult {
  const manifest = readLoadManifest({ cwd: ctx.cwd, homeDir: ctx.homeDir })
  if (!isManifestFresh(manifest, { cwd: ctx.cwd, homeDir: ctx.homeDir })) {
    return {
      id: "server-load-manifest",
      label: "Server load manifest",
      ok: true,
      detail: "no fresh server manifest for this project; duplicate/env checks use doctor process env",
    }
  }
  const pkg = JSON.parse(readFileSync(ownPackageJsonPath(), "utf-8"))
  if (manifest.version !== pkg.version) {
    return {
      id: "server-load-manifest",
      label: "Server load manifest",
      ok: false,
      detail: `server manifest version ${manifest.version} does not match doctor package ${pkg.version}`,
      fixHint: "Start a brand-new opencode session so the server loads the same plugin version the doctor is checking.",
    }
  }
  return {
    id: "server-load-manifest",
    label: "Server load manifest",
    ok: true,
    detail: `fresh server manifest: cliDispatchDev=${manifest.cliDispatchDev}, tools=${manifest.tools.join(", ")}`,
  }
}

export function checkDuplicatePluginRegistration(ctx: DoctorContext): CheckResult {
  const configCandidates = [
    join(ctx.cwd, "opencode.json"),
    join(ctx.cwd, "opencode.jsonc"),
    join(ctx.homeDir, ".config", "opencode", "opencode.json"),
    join(ctx.homeDir, ".config", "opencode", "opencode.jsonc"),
  ]
  const declaredIn = configCandidates.find((path) => existsSync(path) && readFileSync(path, "utf-8").includes(PKG))

  const wrapperDirs = [
    join(ctx.cwd, ".opencode", "plugin"),
    join(ctx.homeDir, ".config", "opencode", "plugins"),
  ]
  const { serverCliDispatchDev, source } = devGateSource(ctx)
  const activeWrappers: string[] = []
  const inactiveDevWrappers: string[] = []
  for (const dir of wrapperDirs) {
    if (!existsSync(dir)) continue
    for (const file of readdirSync(dir)) {
      if (!/\.(ts|js)$/.test(file)) continue
      const path = join(dir, file)
      const text = readFileSync(path, "utf-8")
      if (!isCliDispatchWrapper(text)) continue
      if (wrapperIsActive(text, serverCliDispatchDev)) activeWrappers.push(path)
      else inactiveDevWrappers.push(path)
    }
  }

  if (declaredIn && activeWrappers.length > 0) {
    return {
      id: "duplicate-plugin-registration",
      label: "Duplicate plugin registration",
      ok: false,
      detail: `plugin is declared in ${declaredIn} and also loaded by wrapper(s): ${activeWrappers.join(", ")} (dev-gate source: ${source})`,
      fixHint:
        "Keep one registration source. For this repo's old dogfood wrapper, run \"cli-dispatch doctor --fix\"; otherwise disable the wrapper or unset CLI_DISPATCH_DEV in the opencode server environment.",
    }
  }

  if (declaredIn && inactiveDevWrappers.length > 0) {
    return {
      id: "duplicate-plugin-registration",
      label: "Duplicate plugin registration",
      ok: true,
      detail: `dev-gated wrapper present but disabled (dev-gate source: ${source}): ${inactiveDevWrappers.join(", ")}`,
    }
  }

  return {
    id: "duplicate-plugin-registration",
    label: "Duplicate plugin registration",
    ok: true,
    detail: `no duplicate registration (dev-gate source: ${source})`,
  }
}
```

In `src/doctor/checks.ts`, import and insert the check:

```ts
import { checkPluginRegistered, checkConfigFile, checkOpencodeCompat, fixPluginRegistration, checkDuplicatePluginRegistration, fixDuplicatePluginRegistration, checkServerLoadManifest } from "./env-checks"
```

```ts
  results.push(await safe("duplicate-plugin-registration", "Duplicate plugin registration", () => checkDuplicatePluginRegistration(ctx)))
  results.push(await safe("server-load-manifest", "Server load manifest", () => checkServerLoadManifest(ctx)))
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test src/__tests__/doctor-checks.test.ts`
Expected: PASS.

- [ ] **Step 5: Build and commit**

Run:

```bash
bun run build
git add src/doctor/env-checks.ts src/doctor/checks.ts src/__tests__/doctor-checks.test.ts dist
git commit -m "feat: read server load manifest in cli-dispatch doctor"
```

Expected: commit succeeds.

---

### Task 3: CI workflow, changelog, and stale install docs

**Files:**
- Create: `.github/workflows/ci.yml`
- Create: `CHANGELOG.md`
- Modify: `docs/installation.md:34-36`

**Interfaces:**
- Consumes: existing scripts `build`, `test`, `test:dev`, `test:isolated` from `package.json`.
- Produces: CI workflow running those scripts on Ubuntu; changelog starting at `1.2.1` and including `1.3.0`.

- [ ] **Step 1: Create the CI workflow**

Create `.github/workflows/ci.yml`:

```yaml
name: ci

on:
  push:
    branches: [master]
  pull_request:

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: latest
      - run: bun install
      - run: bun run build
      - run: bun test
      - run: bun run test:dev
      - run: bun run test:isolated
```

- [ ] **Step 2: Create the changelog**

Create `CHANGELOG.md`:

```md
# Changelog

## 1.3.0 - 2026-07-27

- Add a per-project server load manifest so `cli-dispatch doctor` can judge duplicate registration and `CLI_DISPATCH_DEV` state from the OpenCode server process, not just the doctor process.
- Add CI for build, default tests, `CLI_DISPATCH_DEV=1` tests, and isolated-HOME tests.
- Fix stale tarball version in installation docs.

## 1.2.1 - 2026-07-27

- Clarify doctor env-scope detail and restore config lookup note in installation docs.
- Add `bun run test:dev` for the `CLI_DISPATCH_DEV=1` test matrix.

## 1.2.0 - 2026-07-27

- Gate the repo-local plugin wrapper behind `CLI_DISPATCH_DEV=1`.
- Tell stale sessions to start a brand-new OpenCode session instead of resuming.
- Add doctor duplicate-registration detection and safe fix for the old dogfood wrapper.
```

- [ ] **Step 3: Fix stale tarball version**

In `docs/installation.md`, replace both `opencode-cli-dispatch-1.0.3.tgz` occurrences with `opencode-cli-dispatch-<version>.tgz`.

- [ ] **Step 4: Verify docs and workflow files**

Run:

```bash
git diff -- .github/workflows/ci.yml CHANGELOG.md docs/installation.md
```

Expected: only the three intended files change; no `1.0.3` remains in `docs/installation.md`.

- [ ] **Step 5: Commit**

Run:

```bash
git add .github/workflows/ci.yml CHANGELOG.md docs/installation.md
git commit -m "ci: add test matrix workflow and changelog"
```

Expected: commit succeeds.

---

### Task 4: Full verification and 1.3.0 release

**Files:**
- Modify: `package.json:3`
- Modify if build output changes: `dist/**`

**Interfaces:**
- Consumes: Tasks 1-3.
- Produces: green full test matrix, fresh `dist/`, and release commit `chore(release): 1.3.0`.

- [ ] **Step 1: Run the full test matrix**

Run: `bun test && bun run test:dev && bun run test:isolated`
Expected: all pass.

- [ ] **Step 2: Rebuild dist**

Run: `bun run build`
Expected: TypeScript build completes; commit `dist/` if it changed.

- [ ] **Step 3: Run doctor**

Run: `node dist/doctor/cli.js`
Expected: includes `server-load-manifest`; exits 0 or reports only a real environment problem. If slash commands are stale, run `node dist/doctor/cli.js --fix` and re-run.

- [ ] **Step 4: Bump version and commit release**

In `package.json`, set `"version": "1.3.0"`, then run:

```bash
git add package.json CHANGELOG.md dist
git commit -m "chore(release): 1.3.0"
```

Expected: commit succeeds. If `dist/` had no changes, commit only `package.json` and `CHANGELOG.md`.

## Self-Review

- Spec coverage: Task 1 implements manifest write/read; Task 2 implements doctor server-truth source and fallback; Task 3 implements CI, changelog, and stale doc fix; Task 4 implements full verification and `1.3.0` release.
- Placeholder scan: no TBD/TODO; every code-changing step includes exact code or exact replacement text.
- Type consistency: `LoadManifest`, `LoadManifestContext`, `writeLoadManifest`, `readLoadManifest`, `isManifestFresh`, `manifestPath`, and `checkServerLoadManifest` are used with the same names in Tasks 1 and 2.
