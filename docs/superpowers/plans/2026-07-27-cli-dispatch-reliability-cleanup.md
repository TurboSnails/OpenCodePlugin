# cli-dispatch reliability cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove duplicate plugin registration drift, make old-session `/cc` failures tell users to start a brand-new OpenCode session, and teach doctor to detect/fix safe registration and command problems.

**Architecture:** Keep the global git plugin as the only always-on registration. The repo-local `.opencode/plugin/cli-dispatch.ts` becomes a dev-gated no-op unless `CLI_DISPATCH_DEV=1`. Generated delegate commands get a clearer tool-snapshot guard; doctor gains a duplicate-registration check plus safe fixes for global commands and the old always-on dogfood wrapper.

**Tech Stack:** Bun, TypeScript, OpenCode plugin API, bun:test.

## Global Constraints

- `dist/` is committed; every `src/` change must be followed by `bun run build` and the `dist/` output must be included in the same commit.
- Formal registration stays `opencode-cli-dispatch@git+https://github.com/TurboSnails/OpenCodePlugin.git` in `~/.config/opencode/opencode.json`.
- Local repo dogfooding is opt-in only via `CLI_DISPATCH_DEV=1`.
- Do not change sticky-routing model compliance behavior, verifiedModels semantics, or delegate spawn flags.
- Tests must run with `bun test` from the repo root.

---

### Task 1: Dev-gated local plugin wrapper

**Files:**
- Create: `src/local-plugin.ts`
- Modify: `.opencode/plugin/cli-dispatch.ts`
- Test: `src/__tests__/local-plugin.test.ts`

**Interfaces:**
- Consumes: `createCliDispatchPlugin(configPath?: string, options?: { commandsDir?: string }): Plugin` from `src/index.ts`.
- Produces: `createLocalCliDispatchPlugin(configPath?: string, options?: { commandsDir?: string }): Plugin`; returns an empty-hooks plugin unless `process.env.CLI_DISPATCH_DEV === "1"`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync, existsSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"
import { createLocalCliDispatchPlugin } from "../local-plugin"

let dir: string
let originalDev: string | undefined

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "cli-dispatch-local-plugin-test-"))
  originalDev = process.env.CLI_DISPATCH_DEV
})

afterEach(() => {
  if (originalDev === undefined) delete process.env.CLI_DISPATCH_DEV
  else process.env.CLI_DISPATCH_DEV = originalDev
  rmSync(dir, { recursive: true, force: true })
})

function writeConfig(configPath: string): void {
  writeFileSync(
    configPath,
    JSON.stringify({
      delegates: {
        myagent: {
          binary: "myagent",
          parser: "raw",
          startArgs: ["--", "{prompt}"],
          replyArgs: ["--resume", "{externalId}", "--", "{prompt}"],
        },
      },
    }),
  )
}

describe("createLocalCliDispatchPlugin", () => {
  it("returns empty hooks when CLI_DISPATCH_DEV is not 1", async () => {
    delete process.env.CLI_DISPATCH_DEV
    const configPath = join(dir, "config.json")
    const commandsDir = join(dir, "commands")
    writeConfig(configPath)

    const hooks = await createLocalCliDispatchPlugin(configPath, { commandsDir })({} as any)

    expect(hooks).toEqual({})
    expect(existsSync(join(commandsDir, "myagent.md"))).toBe(false)
  })

  it("loads the local plugin when CLI_DISPATCH_DEV=1", async () => {
    process.env.CLI_DISPATCH_DEV = "1"
    const configPath = join(dir, "config.json")
    const commandsDir = join(dir, "commands")
    writeConfig(configPath)

    const hooks = await createLocalCliDispatchPlugin(configPath, { commandsDir })({} as any)

    expect(Object.keys(hooks.tool!)).toEqual([
      "myagent_start",
      "myagent_reply",
      "myagent_check",
      "cli_dispatch_doctor",
    ])
    expect(existsSync(join(commandsDir, "myagent.md"))).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/__tests__/local-plugin.test.ts`
Expected: FAIL with `Cannot find module "../local-plugin"` or `createLocalCliDispatchPlugin is not a function`.

- [ ] **Step 3: Write minimal implementation**

Create `src/local-plugin.ts`:

```ts
import type { Plugin } from "@opencode-ai/plugin"
import { createCliDispatchPlugin } from "./index"

export function createLocalCliDispatchPlugin(
  configPath?: string,
  options?: { commandsDir?: string },
): Plugin {
  if (process.env.CLI_DISPATCH_DEV !== "1") {
    return async () => ({})
  }
  return createCliDispatchPlugin(configPath, options)
}
```

Replace `.opencode/plugin/cli-dispatch.ts` with:

```ts
import { createLocalCliDispatchPlugin } from "../../src/local-plugin"

export default createLocalCliDispatchPlugin()
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/__tests__/local-plugin.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 5: Build and commit**

Run:

```bash
bun run build
git add src/local-plugin.ts src/__tests__/local-plugin.test.ts .opencode/plugin/cli-dispatch.ts dist
git commit -m "feat: gate local cli-dispatch plugin behind CLI_DISPATCH_DEV"
```

Expected: commit succeeds; `git status --short` is clean for these files.

---

### Task 2: New-session wording in delegate command guard

**Files:**
- Modify: `src/commands.ts:16`
- Test: `src/__tests__/commands.test.ts:109-124`

**Interfaces:**
- Consumes: existing `generateCommands(config, outputDir)` and `DELEGATE_COMMAND_TEMPLATE`.
- Produces: generated delegate commands whose guard tells users to start a **brand-new** OpenCode session, not merely restart/resume.

- [ ] **Step 1: Update the failing test expectation**

In `src/__tests__/commands.test.ts`, replace the guard test with:

```ts
  it("includes a tool-availability guard in every delegate command", () => {
    generateCommands(configWith("claude", "codex"), dir)

    const claude = readFileSync(join(dir, "claude.md"), "utf-8")
    expect(claude).toContain("Tool availability check")
    expect(claude).toContain("claude_start")
    expect(claude).toContain("全新 opencode 会话")
    expect(claude).toContain("不要 --continue / --session / resume")
    expect(claude).not.toContain("restart opencode")

    const cc = readFileSync(join(dir, "cc.md"), "utf-8")
    expect(cc).toContain("Tool availability check")
    expect(cc).toContain("claude_start")
    expect(cc).toContain("全新 opencode 会话")

    const codex = readFileSync(join(dir, "codex.md"), "utf-8")
    expect(codex).toContain("Tool availability check")
    expect(codex).toContain("codex_start")
    expect(codex).toContain("全新 opencode 会话")
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/__tests__/commands.test.ts`
Expected: FAIL because the template still says `restart opencode` and does not say `全新 opencode 会话`.

- [ ] **Step 3: Update the command template**

In `src/commands.ts`, replace line 16 with:

```ts
**Tool availability check (do this first):** if the \`{{NAME}}_start\` tool is not among your available tools, the cli-dispatch plugin is not loaded in this session's tool snapshot (this conversation was resumed or started before the plugin was installed/updated). Tell the user exactly this: "委派插件未加载：当前会话工具快照早于插件安装/更新。请退出并启动全新 opencode 会话（不要 --continue / --session / resume；桌面 app 要完全 Quit），然后重试 /{{NAME}}。" Then stop — do not answer the delegated message yourself.
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/__tests__/commands.test.ts`
Expected: PASS.

- [ ] **Step 5: Build and commit**

Run:

```bash
bun run build
git add src/commands.ts src/__tests__/commands.test.ts dist
git commit -m "fix: tell stale sessions to start a fresh opencode session"
```

Expected: commit succeeds.

---

### Task 3: Doctor duplicate-registration check and safe fix

**Files:**
- Modify: `src/doctor/env-checks.ts`
- Modify: `src/doctor/checks.ts:9-12,37-39,58-64`
- Test: `src/__tests__/doctor-checks.test.ts`

**Interfaces:**
- Consumes: `DoctorContext`, `CheckResult`, `PKG`, existing `applyFixes` dispatch.
- Produces:
  - `checkDuplicatePluginRegistration(ctx: DoctorContext): CheckResult`
  - `fixDuplicatePluginRegistration(r: CheckResult, ctx: DoctorContext): CheckResult`
  - New check id: `duplicate-plugin-registration`, inserted immediately after `plugin-registered`.

- [ ] **Step 1: Write the failing tests**

Add these tests to `src/__tests__/doctor-checks.test.ts` inside `describe("runChecks")`:

```ts
  it("fails duplicate-plugin-registration when global config and an always-on local wrapper both load the plugin", async () => {
    mkdirSync(join(home, ".config", "opencode"), { recursive: true })
    writeFileSync(
      join(home, ".config", "opencode", "opencode.json"),
      JSON.stringify({ plugin: ["opencode-cli-dispatch@git+https://github.com/TurboSnails/OpenCodePlugin.git"] }),
    )
    mkdirSync(join(cwd, ".opencode", "plugin"), { recursive: true })
    writeFileSync(
      join(cwd, ".opencode", "plugin", "cli-dispatch.ts"),
      'import { createCliDispatchPlugin } from "../../src/index"\n\nexport default createCliDispatchPlugin()\n',
    )

    const results = await run(ctx())
    const check = byId(results, "duplicate-plugin-registration")
    expect(check.ok).toBe(false)
    expect(check.detail).toContain(".opencode/plugin/cli-dispatch.ts")
  })

  it("does not flag a dev-gated local wrapper when CLI_DISPATCH_DEV is unset", async () => {
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

    const results = await run(ctx())
    expect(byId(results, "duplicate-plugin-registration").ok).toBe(true)
  })

  it("runs all nine checks in fixed order", async () => {
    const results = await run(ctx())
    expect(results.map((r) => r.id)).toEqual([
      "plugin-registered",
      "duplicate-plugin-registration",
      "config-file",
      "plugin-tools",
      "opencode-compat",
      "delegate-binaries",
      "cli-authenticated",
      "writability-probe",
      "slash-commands",
    ])
  })
```

Replace the existing `runs all eight checks in fixed order` test with the nine-check version above.

Add this test inside `describe("applyFixes")`:

```ts
  it("disables an old always-on dogfood wrapper after backing it up", async () => {
    mkdirSync(join(home, ".config", "opencode"), { recursive: true })
    writeFileSync(
      join(home, ".config", "opencode", "opencode.json"),
      JSON.stringify({ plugin: ["opencode-cli-dispatch@git+https://github.com/TurboSnails/OpenCodePlugin.git"] }),
    )
    const pluginDir = join(cwd, ".opencode", "plugin")
    mkdirSync(pluginDir, { recursive: true })
    const wrapper = join(pluginDir, "cli-dispatch.ts")
    writeFileSync(
      wrapper,
      'import { createCliDispatchPlugin } from "../../src/index"\n\nexport default createCliDispatchPlugin()\n',
    )

    const results = await run(ctx())
    const fixed = applyFixes(results, ctx())
    const check = byId(fixed, "duplicate-plugin-registration")

    expect(check.ok).toBe(true)
    expect(existsSync(`${wrapper}.bak`)).toBe(true)
    expect(existsSync(`${wrapper}.disabled`)).toBe(true)
    expect(existsSync(wrapper)).toBe(false)
  })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test src/__tests__/doctor-checks.test.ts`
Expected: FAIL with `duplicate-plugin-registration` missing and/or `runs all nine checks` failing.

- [ ] **Step 3: Implement the duplicate-registration scan and fix**

In `src/doctor/env-checks.ts`, update the fs import:

```ts
import { existsSync, readFileSync, readdirSync, writeFileSync, copyFileSync, renameSync } from "fs"
```

Add these functions after `checkPluginRegistered`:

```ts
function wrapperIsDevGated(text: string): boolean {
  return text.includes("CLI_DISPATCH_DEV") || text.includes("createLocalCliDispatchPlugin")
}

function wrapperIsActive(text: string): boolean {
  return wrapperIsDevGated(text) ? process.env.CLI_DISPATCH_DEV === "1" : true
}

function isCliDispatchWrapper(text: string): boolean {
  return (
    text.includes(PKG) ||
    text.includes("createCliDispatchPlugin") ||
    text.includes("createLocalCliDispatchPlugin")
  )
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
  const activeWrappers: string[] = []
  const inactiveDevWrappers: string[] = []
  for (const dir of wrapperDirs) {
    if (!existsSync(dir)) continue
    for (const file of readdirSync(dir)) {
      if (!/\.(ts|js)$/.test(file)) continue
      const path = join(dir, file)
      const text = readFileSync(path, "utf-8")
      if (!isCliDispatchWrapper(text)) continue
      if (wrapperIsActive(text)) activeWrappers.push(path)
      else inactiveDevWrappers.push(path)
    }
  }

  if (declaredIn && activeWrappers.length > 0) {
    return {
      id: "duplicate-plugin-registration",
      label: "Duplicate plugin registration",
      ok: false,
      detail: `plugin is declared in ${declaredIn} and also loaded by wrapper(s): ${activeWrappers.join(", ")}`,
      fixHint:
        "Keep one registration source. For this repo's old dogfood wrapper, run \"cli-dispatch doctor --fix\"; otherwise disable the wrapper or unset CLI_DISPATCH_DEV.",
    }
  }

  if (declaredIn && inactiveDevWrappers.length > 0) {
    return {
      id: "duplicate-plugin-registration",
      label: "Duplicate plugin registration",
      ok: true,
      detail: `dev-gated wrapper present but disabled: ${inactiveDevWrappers.join(", ")}`,
    }
  }

  return {
    id: "duplicate-plugin-registration",
    label: "Duplicate plugin registration",
    ok: true,
    detail: "no duplicate registration",
  }
}

export function fixDuplicatePluginRegistration(r: CheckResult, ctx: DoctorContext): CheckResult {
  const pluginDir = join(ctx.cwd, ".opencode", "plugin")
  if (!existsSync(pluginDir)) return r

  const disabled: string[] = []
  for (const file of readdirSync(pluginDir)) {
    if (!/\.(ts|js)$/.test(file)) continue
    const path = join(pluginDir, file)
    const text = readFileSync(path, "utf-8")
    const isOldDogfoodWrapper =
      text.includes('from "../../src/index"') &&
      text.includes("createCliDispatchPlugin") &&
      !wrapperIsDevGated(text)
    if (!isOldDogfoodWrapper) continue
    copyFileSync(path, `${path}.bak`)
    renameSync(path, `${path}.disabled`)
    disabled.push(path)
  }

  if (disabled.length === 0) {
    return { ...r, detail: `${r.detail} (no old always-on dogfood wrapper found to disable — apply the fixHint manually)` }
  }
  return { ...r, ok: true, detail: `disabled old dogfood wrapper(s): ${disabled.join(", ")}` }
}
```

In `src/doctor/checks.ts`, update the env-checks import:

```ts
import { checkPluginRegistered, checkConfigFile, checkOpencodeCompat, fixPluginRegistration, checkDuplicatePluginRegistration, fixDuplicatePluginRegistration } from "./env-checks"
```

Insert the check after `plugin-registered`:

```ts
  results.push(await safe("plugin-registered", "Plugin registered", () => checkPluginRegistered(ctx)))
  results.push(await safe("duplicate-plugin-registration", "Duplicate plugin registration", () => checkDuplicatePluginRegistration(ctx)))
```

Update `applyFixes`:

```ts
    if (r.id === "slash-commands") return fixSlashCommands(r, ctx)
    if (r.id === "plugin-registered") return fixPluginRegistration(r, ctx)
    if (r.id === "duplicate-plugin-registration") return fixDuplicatePluginRegistration(r, ctx)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test src/__tests__/doctor-checks.test.ts`
Expected: PASS.

- [ ] **Step 5: Build and commit**

Run:

```bash
bun run build
git add src/doctor/env-checks.ts src/doctor/checks.ts src/__tests__/doctor-checks.test.ts dist
git commit -m "feat: detect and safely fix duplicate cli-dispatch registration"
```

Expected: commit succeeds.

---

### Task 4: Align docs with the single-registration model

**Files:**
- Modify: `README.md:30-36`
- Modify: `README_CN.md` (same section as README.md, if present)
- Modify: `docs/installation.md:79-97`
- Modify: `docs/configuration.md:116-123`
- Modify outside git, not committed: `/Users/hassan/.config/opencode/README.md:13-45`

**Interfaces:**
- Consumes: Task 1 dev-gated wrapper behavior, Task 2 fresh-session guard wording, Task 3 doctor duplicate check.
- Produces: docs that say the global git plugin is the formal install path, local wrapper is dev-only, and resumed sessions do not refresh tools.

- [ ] **Step 1: Update repo docs**

In `README.md`, replace the `After installing or updating` section with:

```md
## After installing or updating

opencode loads plugins once at startup. After installing or updating
opencode-cli-dispatch (or regenerating slash commands), quit the current
session and start a **brand-new** opencode session. Do not resume with
`--continue` / `--session`: resumed sessions keep the old tool snapshot and
won't have the newly registered `claude_start` / `codex_start` tools. `/cc`
and `/codex` detect this and tell you to start a fresh session.
```

In `README_CN.md`, make the same semantic change in Chinese: install/update 后必须开全新会话，不要 `--continue` / `--session` / resume。

In `docs/installation.md` Option C, replace step 3's note with:

```md
**3. Start a fresh session after install/update.** OpenCode loads plugins once at startup, so a resumed session (`--continue`, `--session`, desktop session restore) keeps the old tool snapshot. After changing the plugin or its generated commands, fully quit and start a brand-new session before using `/cc` or `/codex`.
```

In `docs/configuration.md` Usage, add after line 123:

```md
After installing or updating the plugin, start a brand-new OpenCode session. Resumed sessions keep the tool snapshot from when they were created and may not have `{name}_start` / `{name}_reply` even though the slash commands exist.
```

- [ ] **Step 2: Update global config README (outside git)**

In `/Users/hassan/.config/opencode/README.md`, replace the `plugins/opencode-cli-dispatch.ts` row with:

```md
| `plugins/`          | Reserved for local plugin wrappers. cli-dispatch is normally loaded from the git package in `opencode.json`, not from a wrapper here. |
```

Replace the "How plugins load" local-wrapper paragraph with:

```md
To load cli-dispatch globally, keep the git package spec in `opencode.json`:
`"opencode-cli-dispatch@git+https://github.com/TurboSnails/OpenCodePlugin.git"`.
Do not add a second wrapper for the same plugin unless you are debugging; duplicate registration is reported by `cli-dispatch doctor`.
```

Replace the line `loads via the wrapper in plugins/opencode-cli-dispatch.ts` with:

```md
loads via the git package spec in `opencode.json`.
```

- [ ] **Step 3: Verify docs diff**

Run:

```bash
git diff -- README.md README_CN.md docs/installation.md docs/configuration.md
```

Expected: only the wording above changes; no command flags or config semantics are altered.

- [ ] **Step 4: Commit repo docs**

Run:

```bash
git add README.md README_CN.md docs/installation.md docs/configuration.md
git commit -m "docs: align cli-dispatch install and stale-session guidance"
```

Expected: commit succeeds. The global README under `~/.config/opencode/` is intentionally not committed.

---

### Task 5: Full verification and release hygiene

**Files:**
- Modify if build output changes: `dist/**`
- Verify only: no source edits expected

**Interfaces:**
- Consumes: Tasks 1-4.
- Produces: green test suite, fresh `dist/`, doctor output showing the new duplicate-registration check, and regenerated global slash commands.

- [ ] **Step 1: Run the full test suite**

Run: `bun test`
Expected: PASS, including `local-plugin.test.ts`, `commands.test.ts`, and `doctor-checks.test.ts`.

- [ ] **Step 2: Rebuild dist**

Run: `bun run build`
Expected: TypeScript build completes with no errors; `git status --short dist` shows any changed compiled files.

- [ ] **Step 3: Run doctor without fix**

Run: `node dist/doctor/cli.js`
Expected: output includes `Duplicate plugin registration (duplicate-plugin-registration)` and ends with non-zero exit only if a real problem remains. If `slash-commands` is stale because Task 2 changed the guard, continue to Step 4.

- [ ] **Step 4: Regenerate global commands and re-run doctor**

Run: `node dist/doctor/cli.js --fix && node dist/doctor/cli.js`
Expected: `slash-commands` is fixed, duplicate registration is either absent or explicitly reported with a fix hint, and the final doctor run exits 0.

- [ ] **Step 5: Commit build output if needed**

Run:

```bash
git status --short
git add dist
git commit -m "chore: rebuild dist for reliability cleanup"
```

Expected: commit succeeds if `dist/` changed; if `dist/` is clean, skip the commit and record that in the final summary.

## Self-Review

- Spec coverage: Task 1 implements dev-gated single registration; Task 2 implements fresh-session guard wording; Task 3 implements duplicate registration detection and safe fix; Task 4 aligns repo and global docs; Task 5 verifies tests, dist, doctor, and global commands.
- Placeholder scan: no TBD/TODO steps; each code-changing step includes exact code or exact replacement text.
- Type consistency: `createLocalCliDispatchPlugin` mirrors `createCliDispatchPlugin(configPath?, options?)`; doctor check id `duplicate-plugin-registration` is used consistently in `runChecks`, `applyFixes`, and tests.
