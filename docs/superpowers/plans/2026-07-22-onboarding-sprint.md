# Onboarding Sprint Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让新用户 5 分钟内从安装跑通首次委派——全局配置查找、doctor 诊断（CLI + 插件内工具）、slash commands 自动注册、npm 发布流水线与 README quickstart。

**Architecture:** 按 spec 的 A1→A4 顺序四个模块。doctor 检查逻辑放在 `src/doctor/` 子目录，检查器为纯函数数组，CLI 入口与插件内 `cli_dispatch_doctor` 工具共享同一份逻辑，仅渲染不同。

**Tech Stack:** TypeScript (ES modules, 无分号, 双引号, 2 空格缩进)、Bun (`bun test`)、tsc 构建到 `dist/`、GitHub Actions。

**Spec:** `docs/superpowers/specs/2026-07-22-onboarding-sprint-design.md`

## Global Constraints

- 代码风格：与现有 `src/` 一致——无分号、双引号、2 空格缩进、ES modules。
- **不引入新运行时依赖**（doctor 只用 Node/Bun 标准库 + 现有依赖）。
- `dist/` 已提交进 git：**每个改 `src/` 的任务在 commit 前必须 `bun run build` 并把 `dist/` 一起提交**。
- 测试框架：`bun:test`（`describe`/`it`/`expect`），临时目录用 `mkdtempSync(join(tmpdir(), ...))`。
- 测试命令：`bun test`；构建命令：`bun run build`（输出到 `dist/`，tsconfig `include: ["src/**/*"]`，`src/doctor/` 自动被编译）。
- 自动生成命令只覆盖 `/<delegate>`、`/opencode` 以及 `claude` 存在时的 `/cc` 别名；绝不覆盖无 `GENERATED_MARKER` 的手工维护文件。

---

### Task 1: 全局配置查找路径（A1）

**Files:**
- Modify: `src/config.ts`（`loadConfig` 区域, 行 175-209）
- Test: `src/__tests__/config.test.ts`

**Interfaces:**
- Consumes: 无
- Produces: `getConfigSearchPaths(configPath?: string, homeDir?: string, cwd?: string): string[]` — 返回完整查找链（configPath 给定时只返回它）。Task 2 的 doctor config 检查复用它。

- [ ] **Step 1: Write the failing test**

在 `src/__tests__/config.test.ts` 的 `loadConfig` describe 块内（文件已有 `join`/`tmpdir` 等 import）追加。先把 import 行改为：

```ts
import { loadConfig, resolveArgs, validateDelegates, isValidVerifiedModelEntry, matchesVerifiedModel, getConfigSearchPaths } from "../config"
```

新增测试：

```ts
  it("appends the global opencode config dir to the default search chain", () => {
    const paths = getConfigSearchPaths(undefined, "/fake/home", "/fake/cwd")
    expect(paths).toEqual([
      "/fake/cwd/cli-dispatch.config.json",
      "/fake/cwd/.opencode/cli-dispatch.config.json",
      "/fake/cwd/.opencode/lib/cli-dispatch/config.json",
      "/fake/home/.config/opencode/cli-dispatch.config.json",
    ])
  })

  it("returns only the explicit configPath when given", () => {
    expect(getConfigSearchPaths("/x/y.json", "/fake/home", "/fake/cwd")).toEqual(["/x/y.json"])
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/__tests__/config.test.ts`
Expected: FAIL with `getConfigSearchPaths is not a function`（或 export 不存在的类型/运行错误）

- [ ] **Step 3: Implement getConfigSearchPaths and rewire loadConfig**

`src/config.ts` 第 1 行 import 改为：

```ts
import { readFileSync, existsSync } from "fs"
import { join } from "path"
import { homedir } from "os"
import { validateArgvInjection } from "./policy"
```

在 `loadConfig` 之前新增导出函数：

```ts
export function getConfigSearchPaths(
  configPath?: string,
  homeDir: string = homedir(),
  cwd: string = process.cwd(),
): string[] {
  if (configPath) return [configPath]
  return [
    join(cwd, "cli-dispatch.config.json"),
    join(cwd, ".opencode", "cli-dispatch.config.json"),
    join(cwd, ".opencode", "lib", "cli-dispatch", "config.json"),
    join(homeDir, ".config", "opencode", "cli-dispatch.config.json"),
  ]
}
```

`loadConfig` 的 searchPaths 赋值改为：

```ts
export function loadConfig(configPath?: string): CliDispatchConfig {
  const searchPaths = getConfigSearchPaths(configPath)
  // ...其余不变
```

- [ ] **Step 4: Run tests**

Run: `bun test src/__tests__/config.test.ts`
Expected: PASS（全部，包括原有测试）

- [ ] **Step 5: Rebuild dist and commit**

```bash
bun run build
git add src/config.ts src/__tests__/config.test.ts dist/
git commit -m "feat: add global ~/.config/opencode config path to search chain (A1)"
```

---

### Task 2: doctor 检查器模块（A2 核心）

**Files:**
- Create: `src/doctor/context.ts`
- Create: `src/doctor/checks.ts`
- Test: `src/__tests__/doctor-checks.test.ts`

**Interfaces:**
- Consumes: `getConfigSearchPaths`（Task 1）、`loadConfig`、`CliDispatchConfig`（src/config.ts）、`checkDelegate`（src/health-check.ts）、`generateCommands`（src/commands.ts）
- Produces（Task 3、4 依赖这些确切签名）:
  - `interface DoctorContext { cwd: string; homeDir: string; pathEnv: string; configPath?: string }`
  - `interface CheckResult { id: string; label: string; ok: boolean; detail: string; fixHint?: string }`
  - `makeContext(overrides?: Partial<DoctorContext>): DoctorContext`
  - `runChecks(ctx: DoctorContext, run?: RunDelegateFn): Promise<CheckResult[]>` — 按固定顺序跑 6 组检查；单组抛异常时该组记 `ok: false` 并附异常摘要，不中断后续检查
  - `applyFixes(results: CheckResult[], ctx: DoctorContext): CheckResult[]` — 仅处理 `id === "plugin-registered"` 和 `id === "slash-commands"` 的可修项，返回更新后的结果

检查顺序与 id（固定）：`plugin-registered` → `config-file` → `delegate-binaries` → `cli-authenticated` → `writability-probe` → `slash-commands`。

- [ ] **Step 1: Write the failing test**

创建 `src/__tests__/doctor-checks.test.ts`：

```ts
import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, chmodSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"
import { makeContext, runChecks } from "../doctor/checks"
import type { DoctorContext } from "../doctor/checks"

let root: string
let home: string
let cwd: string
let bin: string

// Stub for the delegate runner so the writability probe never spawns a real CLI.
const stubRun: any = async () => ({ text: "ok", externalId: "x" })

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "cli-dispatch-doctor-test-"))
  home = join(root, "home")
  cwd = join(root, "cwd")
  bin = join(root, "bin")
  mkdirSync(home, { recursive: true })
  mkdirSync(cwd, { recursive: true })
  mkdirSync(bin, { recursive: true })
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

function ctx(overrides: Partial<DoctorContext> = {}): DoctorContext {
  return makeContext({ cwd, homeDir: home, pathEnv: bin, ...overrides })
}

function run(ctx: DoctorContext) {
  return runChecks(ctx, stubRun)
}

function writeFakeBinary(dir: string, name: string): void {
  const path = join(dir, name)
  writeFileSync(path, "#!/bin/sh\nexit 0\n")
  chmodSync(path, 0o755)
}

function byId(results: { id: string }[], id: string) {
  return results.find((r) => r.id === id)!
}

describe("runChecks", () => {
  it("reports plugin as registered when a global opencode.json declares it", async () => {
    mkdirSync(join(home, ".config", "opencode"), { recursive: true })
    writeFileSync(
      join(home, ".config", "opencode", "opencode.json"),
      JSON.stringify({ plugin: ["opencode-cli-dispatch@github:TurboSnails/OpenCodePlugin"] }),
    )
    const results = await run(ctx())
    expect(byId(results, "plugin-registered").ok).toBe(true)
  })

  it("reports plugin as registered when a wrapper file references the package", async () => {
    mkdirSync(join(home, ".config", "opencode", "plugins"), { recursive: true })
    writeFileSync(
      join(home, ".config", "opencode", "plugins", "cli-dispatch.ts"),
      'import { createCliDispatchPlugin } from "opencode-cli-dispatch"\nexport default createCliDispatchPlugin()\n',
    )
    const results = await run(ctx())
    expect(byId(results, "plugin-registered").ok).toBe(true)
  })

  it("fails plugin-registered with a fix hint when nothing declares the plugin", async () => {
    const results = await run(ctx())
    const check = byId(results, "plugin-registered")
    expect(check.ok).toBe(false)
    expect(check.fixHint).toContain("opencode-cli-dispatch")
  })

  it("fails config-file when the config JSON is invalid", async () => {
    writeFileSync(join(cwd, "cli-dispatch.config.json"), "{ not json")
    const results = await run(ctx())
    const check = byId(results, "config-file")
    expect(check.ok).toBe(false)
    expect(check.detail).toContain("cli-dispatch.config.json")
  })

  it("passes config-file with a note when no config exists (built-in defaults)", async () => {
    const results = await run(ctx())
    const check = byId(results, "config-file")
    expect(check.ok).toBe(true)
    expect(check.detail).toContain("built-in defaults")
  })

  it("detects delegate binaries on PATH and reports missing ones", async () => {
    writeFakeBinary(bin, "claude")
    const results = await run(ctx())
    const check = byId(results, "delegate-binaries")
    expect(check.ok).toBe(false)
    expect(check.detail).toContain("codex")
    expect(check.detail).not.toContain("claude is missing")
  })

  it("checks credential files only for known CLIs", async () => {
    writeFakeBinary(bin, "claude")
    writeFakeBinary(bin, "codex")
    mkdirSync(join(home, ".codex"), { recursive: true })
    writeFileSync(join(home, ".codex", "auth.json"), "{}")
    const results = await run(ctx())
    const check = byId(results, "cli-authenticated")
    expect(check.ok).toBe(false)
    expect(check.detail).toContain("claude")
    expect(check.detail).not.toContain("codex is not authenticated")
  })

  it("fails slash-commands when the global commands dir is empty", async () => {
    const results = await run(ctx())
    const check = byId(results, "slash-commands")
    expect(check.ok).toBe(false)
  })

  it("runs all six checks in fixed order", async () => {
    const results = await run(ctx())
    expect(results.map((r) => r.id)).toEqual([
      "plugin-registered",
      "config-file",
      "delegate-binaries",
      "cli-authenticated",
      "writability-probe",
      "slash-commands",
    ])
  })
})
```

（stubRun 不创建文件，所以 writability-probe 在这些测试里恒为 `ok: false` 且很快——测试只断言顺序和 id，不断言它的 ok 值。）

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/__tests__/doctor-checks.test.ts`
Expected: FAIL——`Cannot find module "../doctor/checks"`

- [ ] **Step 3: Implement src/doctor/context.ts**

```ts
import { homedir } from "os"

export interface DoctorContext {
  cwd: string
  homeDir: string
  pathEnv: string
  configPath?: string
}

export function makeContext(overrides: Partial<DoctorContext> = {}): DoctorContext {
  return {
    cwd: process.cwd(),
    homeDir: homedir(),
    pathEnv: process.env.PATH ?? "",
    ...overrides,
  }
}
```

- [ ] **Step 4: Implement src/doctor/checks.ts**

```ts
import { existsSync, readFileSync, readdirSync, accessSync, constants, mkdtempSync, rmSync, writeFileSync } from "fs"
import { join, delimiter } from "path"
import { tmpdir } from "os"
import type { CliDispatchConfig } from "../config"
import { loadConfig, getConfigSearchPaths } from "../config"
import { checkDelegate, type RunDelegateFn } from "../health-check"
import { generateCommands } from "../commands"

export interface CheckResult {
  id: string
  label: string
  ok: boolean
  detail: string
  fixHint?: string
}

export type { DoctorContext } from "./context"
export { makeContext } from "./context"
import type { DoctorContext } from "./context"

const PKG = "opencode-cli-dispatch"

function checkPluginRegistered(ctx: DoctorContext): CheckResult {
  const candidates = [
    join(ctx.cwd, "opencode.json"),
    join(ctx.cwd, "opencode.jsonc"),
    join(ctx.homeDir, ".config", "opencode", "opencode.json"),
    join(ctx.homeDir, ".config", "opencode", "opencode.jsonc"),
  ]
  for (const path of candidates) {
    if (existsSync(path) && readFileSync(path, "utf-8").includes(PKG)) {
      return { id: "plugin-registered", label: "Plugin registered", ok: true, detail: `declared in ${path}` }
    }
  }
  const wrapperDirs = [
    join(ctx.cwd, ".opencode", "plugin"),
    join(ctx.homeDir, ".config", "opencode", "plugins"),
  ]
  for (const dir of wrapperDirs) {
    if (!existsSync(dir)) continue
    for (const file of readdirSync(dir)) {
      if (!/\.(ts|js)$/.test(file)) continue
      if (readFileSync(join(dir, file), "utf-8").includes(PKG)) {
        return { id: "plugin-registered", label: "Plugin registered", ok: true, detail: `wrapper ${join(dir, file)}` }
      }
    }
  }
  return {
    id: "plugin-registered",
    label: "Plugin registered",
    ok: false,
    detail: "no opencode.json(c) plugin entry or plugin wrapper file mentions opencode-cli-dispatch",
    fixHint:
      `Add to opencode.json: { "plugin": ["${PKG}"] } — or create a wrapper file. ` +
      `Run "cli-dispatch doctor --fix" to patch an existing opencode.json automatically.`,
  }
}

function checkConfigFile(ctx: DoctorContext): { result: CheckResult; config: CliDispatchConfig } {
  const paths = getConfigSearchPaths(ctx.configPath, ctx.homeDir, ctx.cwd)
  const found = paths.find((p) => existsSync(p))
  try {
    const config = loadConfig(ctx.configPath)
    if (!found) {
      return {
        result: { id: "config-file", label: "Config file", ok: true, detail: "no config file found; using built-in defaults" },
        config,
      }
    }
    return {
      result: { id: "config-file", label: "Config file", ok: true, detail: `valid config at ${found}` },
      config,
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return {
      result: {
        id: "config-file",
        label: "Config file",
        ok: false,
        detail: message,
        fixHint: "Fix or remove the config file above, then re-run doctor. See docs/configuration.md for the schema.",
      },
      config: { delegates: {} },
    }
  }
}

function which(binary: string, pathEnv: string): boolean {
  for (const dir of pathEnv.split(delimiter)) {
    if (!dir) continue
    try {
      accessSync(join(dir, binary), constants.X_OK)
      return true
    } catch {
      // not here
    }
  }
  return false
}

function checkBinaries(config: CliDispatchConfig, ctx: DoctorContext): CheckResult {
  const missing = Object.values(config.delegates)
    .map((d) => d.binary)
    .filter((b, i, all) => all.indexOf(b) === i)
    .filter((b) => !which(b, ctx.pathEnv))
  if (missing.length === 0) {
    return { id: "delegate-binaries", label: "Delegate binaries", ok: true, detail: "all delegate binaries found on PATH" }
  }
  return {
    id: "delegate-binaries",
    label: "Delegate binaries",
    ok: false,
    detail: `missing on PATH: ${missing.join(", ")}`,
    fixHint: "Install the missing CLIs (e.g. claude: https://docs.anthropic.com/claude-code, codex: npm i -g @openai/codex) and re-run doctor.",
  }
}

function checkAuthenticated(config: CliDispatchConfig, ctx: DoctorContext): CheckResult {
  const problems: string[] = []
  const binaries = new Set(Object.values(config.delegates).map((d) => d.binary))
  for (const b of binaries) {
    if (b === "claude") {
      const okFile =
        existsSync(join(ctx.homeDir, ".claude", ".credentials.json")) ||
        existsSync(join(ctx.homeDir, ".claude.json"))
      if (!okFile) problems.push("claude is not authenticated")
    } else if (b === "codex") {
      if (!existsSync(join(ctx.homeDir, ".codex", "auth.json"))) problems.push("codex is not authenticated")
    }
  }
  if (problems.length === 0) {
    return { id: "cli-authenticated", label: "CLI authentication", ok: true, detail: "credential files present" }
  }
  return {
    id: "cli-authenticated",
    label: "CLI authentication",
    ok: false,
    detail: problems.join("; "),
    fixHint: "Run the CLI once interactively to log in (e.g. `claude` or `codex login`), then re-run doctor.",
  }
}

async function checkWritability(config: CliDispatchConfig, run: RunDelegateFn): Promise<CheckResult> {
  const failures: string[] = []
  for (const [name, cfg] of Object.entries(config.delegates)) {
    const res = await checkDelegate(name, cfg, run)
    if (!res.ok) failures.push(res.detail)
  }
  if (failures.length === 0) {
    return { id: "writability-probe", label: "Writability probe", ok: true, detail: "all delegates created files in an isolated directory" }
  }
  return {
    id: "writability-probe",
    label: "Writability probe",
    ok: false,
    detail: failures.join("; "),
    fixHint: "Check the permission/sandbox flags in cli-dispatch.config.json (see docs/configuration.md#delegate-permissions).",
  }
}

function globalCommandsDir(ctx: DoctorContext): string {
  return join(ctx.homeDir, ".config", "opencode", "commands")
}

function checkSlashCommands(config: CliDispatchConfig, ctx: DoctorContext): CheckResult {
  const dir = globalCommandsDir(ctx)
  const tmp = mkdtempSync(join(tmpdir(), "cli-dispatch-doctor-cmds-"))
  try {
    generateCommands(config, tmp)
    const expected = readdirSync(tmp).filter((f) => f.endsWith(".md"))
    const stale: string[] = []
    for (const file of expected) {
      const target = join(dir, file)
      if (!existsSync(target) || readFileSync(target, "utf-8") !== readFileSync(join(tmp, file), "utf-8")) {
        stale.push(file)
      }
    }
    if (stale.length === 0) {
      return { id: "slash-commands", label: "Slash commands", ok: true, detail: `up to date in ${dir}` }
    }
    return {
      id: "slash-commands",
      label: "Slash commands",
      ok: false,
      detail: `missing or stale in ${dir}: ${stale.join(", ")}`,
      fixHint: 'Run "cli-dispatch doctor --fix" to regenerate them.',
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
}

export async function runChecks(ctx: DoctorContext, run: RunDelegateFn): Promise<CheckResult[]> {
  const results: CheckResult[] = []
  let config: CliDispatchConfig = { delegates: {} }

  const safe = async (fn: () => CheckResult | Promise<CheckResult>): Promise<CheckResult> => {
    try {
      return await fn()
    } catch (err) {
      return {
        id: "internal-error",
        label: "Internal check error",
        ok: false,
        detail: err instanceof Error ? err.message : String(err),
      }
    }
  }

  results.push(await safe(() => checkPluginRegistered(ctx)))

  const configOutcome = await safe(() => checkConfigFile(ctx).result)
  // config 需要在 safe 外提取以便后续检查使用
  try {
    config = loadConfig(ctx.configPath)
  } catch {
    config = { delegates: {} }
  }
  results.push(configOutcome)

  results.push(await safe(() => checkBinaries(config, ctx)))
  results.push(await safe(() => checkAuthenticated(config, ctx)))
  results.push(await safe(() => checkWritability(config, run)))
  results.push(await safe(() => checkSlashCommands(config, ctx)))

  return results
}

export function applyFixes(results: CheckResult[], ctx: DoctorContext): CheckResult[] {
  return results.map((r) => {
    if (r.ok) return r
    if (r.id === "slash-commands") {
      try {
        const config = loadConfig(ctx.configPath)
        generateCommands(config, globalCommandsDir(ctx))
        return { ...r, ok: true, detail: `regenerated into ${globalCommandsDir(ctx)}` }
      } catch (err) {
        return { ...r, detail: `${r.detail} (fix failed: ${err instanceof Error ? err.message : String(err)})` }
      }
    }
    if (r.id === "plugin-registered") {
      const candidates = [join(ctx.cwd, "opencode.json"), join(ctx.homeDir, ".config", "opencode", "opencode.json")]
      for (const path of candidates) {
        if (!existsSync(path)) continue
        try {
          const obj = JSON.parse(readFileSync(path, "utf-8"))
          const plugins: string[] = Array.isArray(obj.plugin) ? obj.plugin : []
          if (!plugins.some((p) => typeof p === "string" && p.includes(PKG))) {
            obj.plugin = [...plugins, PKG]
            writeFileSync(path, JSON.stringify(obj, null, 2) + "\n", "utf-8")
          }
          return { ...r, ok: true, detail: `added "${PKG}" to plugin array in ${path}` }
        } catch {
          // fall through to next candidate / report-only
        }
      }
      return { ...r, detail: `${r.detail} (no writable opencode.json found to patch — apply the fixHint manually)` }
    }
    return r
  })
}
```

- [ ] **Step 5: Run tests**

Run: `bun test src/__tests__/doctor-checks.test.ts`
Expected: PASS

- [ ] **Step 6: Rebuild dist and commit**

```bash
bun run build
git add src/doctor/ src/__tests__/doctor-checks.test.ts dist/
git commit -m "feat: add doctor check module with six onboarding checks (A2 core)"
```

---

### Task 3: doctor CLI 入口（A2）

**Files:**
- Create: `src/doctor/format.ts`
- Create: `src/doctor/cli.ts`
- Modify: `package.json`（加 `bin` 字段）
- Test: `src/__tests__/doctor-cli.test.ts`

**Interfaces:**
- Consumes: `runChecks`、`applyFixes`、`CheckResult`、`makeContext`（Task 2）、`runDelegate`（src/run-delegate.ts）
- Produces: `formatResults(results: CheckResult[]): string` — Task 4 的插件工具复用；`cli.ts` 编译为 `dist/doctor/cli.js`，作为 npm `bin` 入口

- [ ] **Step 1: Write the failing test**

创建 `src/__tests__/doctor-cli.test.ts`（用 `bun run` 直接跑 TS 源码做集成测试，HOME/PATH 注入临时目录）：

```ts
import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { mkdtempSync, mkdirSync, rmSync, symlinkSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"

let root: string
let home: string
let cwd: string
let cleanPath: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "cli-dispatch-doctor-cli-"))
  home = join(root, "home")
  cwd = join(root, "cwd")
  mkdirSync(home, { recursive: true })
  mkdirSync(cwd, { recursive: true })
  // Clean PATH that contains only `bun` (symlinked to process.execPath) so the
  // CLI never finds claude/codex and the writability probe fails fast without
  // calling a real CLI.
  cleanPath = join(root, "clean-path")
  mkdirSync(cleanPath, { recursive: true })
  symlinkSync(process.execPath, join(cleanPath, "bun"))
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

const CLI = join(import.meta.dir, "..", "doctor", "cli.ts")

function runDoctorCli(): { exitCode: number; stdout: string } {
  const proc = Bun.spawnSync(["bun", "run", CLI], {
    cwd,
    env: { ...process.env, HOME: home, PATH: cleanPath },
    stdout: "pipe",
    stderr: "pipe",
  })
  return { exitCode: proc.exitCode, stdout: proc.stdout.toString() }
}

describe("doctor CLI", () => {
  it("exits 1 and marks failures with ✗ in a bare environment", () => {
    const { exitCode, stdout } = runDoctorCli()
    expect(exitCode).toBe(1)
    expect(stdout).toContain("✗")
    expect(stdout).toContain("plugin-registered")
  }, 30_000)
})
```

（bare 环境下 claude/codex 不在 PATH，writability-probe 会因 spawn 失败迅速返回 failure，不会真调 API。）

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/__tests__/doctor-cli.test.ts`
Expected: FAIL——CLI 文件不存在（spawn 退出码非 1 或输出不符）

- [ ] **Step 3: Implement src/doctor/format.ts**

```ts
import type { CheckResult } from "./checks"

export function formatResults(results: CheckResult[]): string {
  const lines: string[] = []
  let firstFailure = true
  for (const r of results) {
    lines.push(`${r.ok ? "✓" : "✗"} ${r.label} (${r.id}): ${r.detail}`)
    if (!r.ok && firstFailure && r.fixHint) {
      lines.push(`  → fix: ${r.fixHint}`)
      firstFailure = false
    }
  }
  const failed = results.some((r) => !r.ok)
  if (!failed) {
    lines.push("", "All checks passed. Run `/claude hello` (or `/cc hello`) in opencode to verify end-to-end.")
  }
  return lines.join("\n")
}
```

- [ ] **Step 4: Implement src/doctor/cli.ts**

```ts
#!/usr/bin/env node
import { runChecks, applyFixes } from "./checks"
import { makeContext } from "./context"
import { formatResults } from "./format"
import { runDelegate } from "../run-delegate"

const fix = process.argv.includes("--fix")

const ctx = makeContext()
const results = await runChecks(ctx, runDelegate)
const final = fix ? applyFixes(results, ctx) : results

console.log(formatResults(final))
process.exit(final.some((r) => !r.ok) ? 1 : 0)
```

- [ ] **Step 5: Add bin to package.json**

`package.json` 在 `"main"` 之后插入：

```json
  "bin": {
    "cli-dispatch": "./dist/doctor/cli.js"
  },
```

- [ ] **Step 6: Run tests**

Run: `bun test src/__tests__/doctor-cli.test.ts`
Expected: PASS

- [ ] **Step 7: Rebuild dist, verify bin, commit**

```bash
bun run build
node dist/doctor/cli.js; echo "exit=$?"   # 预期 exit=1（裸环境部分检查不过），输出含 ✓/✗ 行
git add src/doctor/ src/__tests__/doctor-cli.test.ts package.json dist/
git commit -m "feat: add cli-dispatch doctor CLI with --fix (A2)"
```

> 注意：CLI 会通过 `runDelegate` 链路间接依赖 `@opencode-ai/plugin`（当前 `peerDependencies`）。npm v7+ 安装 peer deps 时会自动拉取，所以 `npx opencode-cli-dispatch doctor` 能跑；这是现有依赖，未引入新运行时依赖。

---

### Task 4: 插件内 cli_dispatch_doctor 工具（A2）

**Files:**
- Create: `src/doctor/tool.ts`
- Modify: `src/index.ts`（tools 注册，正常与降级两条路径）
- Test: `src/__tests__/doctor-tool.test.ts`

**Interfaces:**
- Consumes: `runChecks`、`makeContext`、`formatResults`（Task 2/3）、`tool` from `@opencode-ai/plugin`
- Produces: `makeDoctorTool(run?: RunDelegateFn)` 返回名为 `cli_dispatch_doctor` 的工具定义；`src/index.ts` 同时导出它

- [ ] **Step 1: Write the failing test**

创建 `src/__tests__/doctor-tool.test.ts`：

```ts
import { describe, it, expect } from "bun:test"
import { mkdtempSync, mkdirSync, rmSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"
import { makeDoctorTool } from "../doctor/tool"

describe("makeDoctorTool", () => {
  it("returns a report string covering all six check ids", async () => {
    const root = mkdtempSync(join(tmpdir(), "cli-dispatch-doctor-tool-"))
    try {
      const homeDir = join(root, "home")
      const cwd = join(root, "cwd")
      mkdirSync(homeDir, { recursive: true })
      mkdirSync(cwd, { recursive: true })
      const stubRun: any = async () => ({ text: "ok", externalId: "x" })
      const tool = makeDoctorTool(stubRun, { cwd, homeDir, pathEnv: join(root, "bin") })
      const report: string = await tool.execute({}, { sessionID: "s1" } as any)
      for (const id of ["plugin-registered", "config-file", "delegate-binaries", "cli-authenticated", "writability-probe", "slash-commands"]) {
        expect(report).toContain(id)
      }
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/__tests__/doctor-tool.test.ts`
Expected: FAIL——`Cannot find module "../doctor/tool"`

- [ ] **Step 3: Implement src/doctor/tool.ts**

```ts
import { tool } from "@opencode-ai/plugin"
import { runChecks } from "./checks"
import { makeContext, type DoctorContext } from "./context"
import { formatResults } from "./format"
import { runDelegate } from "../run-delegate"
import type { RunDelegateFn } from "../health-check"

export function makeDoctorTool(run: RunDelegateFn = runDelegate, overrides: Partial<DoctorContext> = {}) {
  return tool({
    description:
      "Diagnose the cli-dispatch installation: plugin registration, config file validity, delegate binaries on PATH, CLI authentication, writability probe, and slash command freshness. Returns one line per check with a fix hint for the first failure.",
    args: {},
    async execute(_args, context) {
      const ctx = makeContext({ cwd: context.directory ?? process.cwd(), ...overrides })
      const results = await runChecks(ctx, run)
      return formatResults(results)
    },
  })
}
```

- [ ] **Step 4: Register in src/index.ts**

在 import 区加：

```ts
import { makeDoctorTool } from "./doctor/tool"
```

`tools` 正常路径构建处（`Object.fromEntries(...)` 之后）改为：

```ts
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
```

降级路径 catch 块内改为：

```ts
      tools = { cli_dispatch_status: makeStatusTool(err), cli_dispatch_doctor: makeDoctorTool() }
```

`src/index.ts` 导出区加：

```ts
export { makeDoctorTool } from "./doctor/tool"
```

- [ ] **Step 5: Run tests**

Run: `bun test src/__tests__/doctor-tool.test.ts src/__tests__/index.test.ts`
Expected: PASS

- [ ] **Step 6: Rebuild dist and commit**

```bash
bun run build
git add src/doctor/tool.ts src/index.ts src/__tests__/doctor-tool.test.ts dist/
git commit -m "feat: add cli_dispatch_doctor in-chat diagnostic tool (A2)"
```

---

### Task 5: slash commands 自动注册（A3）

**Files:**
- Modify: `src/commands.ts`（幂等写入 + `/cc` 别名）
- Modify: `src/index.ts`（默认写入全局 commands 目录，失败降级为警告）
- Test: `src/__tests__/commands.test.ts`

**Interfaces:**
- Consumes: `generateCommands(config, outputDir)`（现有签名不变）、`GENERATED_MARKER`（src/policy.ts）
- Produces: 行为契约——重复调用 `generateCommands` 第二次不产生文件 mtime 变化（内容一致则跳过）；配置含 `claude` 时额外生成 `cc.md`；`createCliDispatchPlugin()` 无参调用时默认写入 `~/.config/opencode/commands/`

- [ ] **Step 1: Write the failing tests**

`src/__tests__/commands.test.ts` 的 `generateCommands` describe 块内追加：

```ts
  it("is idempotent: a second run leaves file contents and mtimes unchanged", async () => {
    generateCommands(configWith("claude"), dir)
    const first = readFileSync(join(dir, "claude.md"), "utf-8")
    const stat1 = (await import("fs")).statSync(join(dir, "claude.md")).mtimeMs
    await new Promise((r) => setTimeout(r, 20))
    generateCommands(configWith("claude"), dir)
    const stat2 = (await import("fs")).statSync(join(dir, "claude.md")).mtimeMs
    expect(readFileSync(join(dir, "claude.md"), "utf-8")).toBe(first)
    expect(stat2).toBe(stat1)
  })

  it("generates a cc.md alias when a claude delegate is configured", () => {
    generateCommands(configWith("claude"), dir)
    const cc = readFileSync(join(dir, "cc.md"), "utf-8")
    expect(cc).toContain("delegate: claude")
    expect(cc).toContain("Alias")
  })

  it("never overwrites a hand-maintained cc.md (no generated marker)", () => {
    writeFileSync(join(dir, "cc.md"), "# my custom cc command\n")
    generateCommands(configWith("claude"), dir)
    expect(readFileSync(join(dir, "cc.md"), "utf-8")).toBe("# my custom cc command\n")
  })

  it("removes a stale generated cc.md when claude is no longer configured", () => {
    generateCommands(configWith("claude"), dir)
    expect(existsSync(join(dir, "cc.md"))).toBe(true)
    generateCommands(configWith("codex"), dir)
    expect(existsSync(join(dir, "cc.md"))).toBe(false)
  })
```

（`writeFileSync`/`existsSync`/`readFileSync`/`join` 在该测试文件已有 import。）

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test src/__tests__/commands.test.ts`
Expected: FAIL——mtime 变化 / cc.md 不存在

- [ ] **Step 3: Implement idempotent writes and the cc alias in src/commands.ts**

在 `generateDelegateCommand` 之后、`generateCommands` 之前加：

```ts
function writeIfChanged(path: string, content: string): void {
  if (existsSync(path) && readFileSync(path, "utf-8") === content) return
  writeFileSync(path, content, "utf-8")
}

function generateCcAlias(name: string, otherNames: string[]): string {
  return generateDelegateCommand(name, otherNames).replace(
    /^description: .*$/m,
    `description: Alias for /${name} — delegate this conversation to the ${name} CLI (sticky)`,
  )
}
```

`generateCommands` 函数体改为：

```ts
export function generateCommands(config: CliDispatchConfig, outputDir: string): void {
  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true })
  }

  const names = Object.keys(config.delegates)

  // Generate delegate commands
  for (const name of names) {
    const content = generateDelegateCommand(name, names.filter((n) => n !== name))
    writeIfChanged(join(outputDir, `${name}.md`), content)
  }

  // Generate /opencode command (always needed)
  writeIfChanged(join(outputDir, "opencode.md"), OPENCODE_COMMAND_TEMPLATE)

  // Generate /cc alias for claude; never clobber a hand-maintained file
  const ccPath = join(outputDir, "cc.md")
  if (names.includes("claude")) {
    const alias = generateCcAlias("claude", names.filter((n) => n !== "claude"))
    if (!existsSync(ccPath) || readFileSync(ccPath, "utf-8").includes(GENERATED_MARKER)) {
      writeIfChanged(ccPath, alias)
    }
  }

  // Remove command files we generated for delegates that are no longer
  // configured. Only files carrying the generated marker are eligible;
  // hand-maintained files (no marker) are never touched.
  const current = new Set([...names.map((n) => `${n}.md`), "opencode.md"])
  if (names.includes("claude")) current.add("cc.md")
  for (const file of readdirSync(outputDir)) {
    if (!file.endsWith(".md") || current.has(file)) continue
    const path = join(outputDir, file)
    if (readFileSync(path, "utf-8").includes(GENERATED_MARKER)) {
      rmSync(path)
    }
  }
}
```

- [ ] **Step 4: Wire the default global commands dir in src/index.ts**

import 区加：

```ts
import { homedir } from "os"
import { join } from "path"
```

`createCliDispatchPlugin` 内的 `if (options?.commandsDir)` 块替换为：

```ts
      const commandsDir = options?.commandsDir ?? join(homedir(), ".config", "opencode", "commands")
      try {
        generateCommands(config, commandsDir)
      } catch (err) {
        console.warn(
          `[cli-dispatch] could not write slash commands to ${commandsDir}: ${err instanceof Error ? err.message : String(err)}. ` +
            `Run "cli-dispatch doctor" later to diagnose.`,
        )
      }
```

- [ ] **Step 5: Run tests**

Run: `bun test src/__tests__/commands.test.ts src/__tests__/index.test.ts`
Expected: PASS

- [ ] **Step 6: Rebuild dist and commit**

```bash
bun run build
git add src/commands.ts src/index.ts src/__tests__/commands.test.ts dist/
git commit -m "feat: auto-register slash commands to global commands dir with idempotent writes (A3)"
```

---

### Task 6: CI 与发布流水线（A4）

**Files:**
- Create: `.github/workflows/ci.yml`
- Create: `.github/workflows/publish.yml`
- Modify: `package.json`（无需改 version；确认 bin/files 已就位——bin 在 Task 3 已加）

**Interfaces:**
- Consumes: 现有 `bun install` / `bun test` / `bun run build` 脚本；npm 包名 `opencode-cli-dispatch`
- Produces: tag `v*` push 自动发布；每个 PR/push 跑测试并校验 `dist/` 与源码同步

- [ ] **Step 1: Create .github/workflows/ci.yml**

```yaml
name: ci

on:
  pull_request:
  push:
    branches: [master]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
      - run: bun install
      - run: bun test
      - run: bun run build
      - name: dist must be in sync with src
        run: git diff --exit-code dist/
```

- [ ] **Step 2: Create .github/workflows/publish.yml**

```yaml
name: publish

on:
  push:
    tags: ["v*"]

jobs:
  publish:
    runs-on: ubuntu-latest
    permissions:
      id-token: write
      contents: read
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
      - uses: actions/setup-node@v4
        with:
          node-version: "22"
          registry-url: "https://registry.npmjs.org"
      - run: bun install
      - run: bun test
      - run: bun run build
      - name: Publish to npm
        run: npm publish --provenance --access public
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
```

- [ ] **Step 3: Verify package name availability (manual)**

Run: `npm view opencode-cli-dispatch`
Expected: `npm error 404` （名字可用）。若已被占用，把 `package.json` 的 `name` 改为 `@<你的npm账号>/opencode-cli-dispatch`，并把 Task 2 中 `PKG` 常量和 README 里的包名同步替换。

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/ 
git commit -m "ci: add test/build/dist-sync workflow and npm publish pipeline (A4)"
```

---

### Task 7: README quickstart 重排与文档下沉（A4）

**Files:**
- Modify: `README.md`
- Create: `docs/installation.md`、`docs/configuration.md`、`docs/claude-code-adapter.md`
- Modify: `README_CN.md`（顶部同步加 quickstart 链接段）

**Interfaces:**
- Consumes: 现有 README.md 各节（逐字移动，不重写）
- Produces: README 顶部 30 秒 quickstart；长文档在 `docs/`；E2E 验收 checklist

- [ ] **Step 1: Restructure README.md**

新 README 结构（精确到节）：

1. 标题 + 一句话简介（保留现有第 1-5 行）
2. 新增 `## Quickstart` 节，内容逐字如下：

````markdown
## Quickstart

```bash
# 1. install the plugin (in any opencode project, or globally)
bun add opencode-cli-dispatch
```

```jsonc
// 2. register it — opencode.json (project) or ~/.config/opencode/opencode.json (global)
{
  "plugin": ["opencode-cli-dispatch"]
}
```

```
3. in opencode: /claude hello        # or /codex hello
```

Slash commands (`/<delegate>`, `/cc`, `/opencode`) are written to `~/.config/opencode/commands/` automatically on plugin load.

**Stuck?** Run `npx opencode-cli-dispatch doctor` (or `cli-dispatch doctor --fix`) — it checks registration, config, binaries, authentication, writability, and slash commands, and tells you exactly what to fix.

Full docs: [Installation](docs/installation.md) · [Configuration](docs/configuration.md) · [Claude Code adapter](docs/claude-code-adapter.md)
````

3. `## Features`（保留现有内容）
4. `## How it works`（保留现有内容）
5. 现有 `## Building a package` + `## Installation`（含 Option A/B/C）→ 逐字移入 `docs/installation.md`，README 原处只留一行链接
6. 现有 `## Configuration`（含 verified models、config errors、permissions、usage、timeout、known limitations）→ 逐字移入 `docs/configuration.md`，README 原处只留一行链接
7. 现有 `## Claude Code adapter` → 逐字移入 `docs/claude-code-adapter.md`，README 原处只留一行链接
8. `## Development`、`## License` 保留在 README

同时把 `docs/configuration.md` 中 "Configuration" 一节的查找链列表更新为 5 条（在 `.opencode/lib/cli-dispatch/config.json` 后加 `~/.config/opencode/cli-dispatch.config.json`，内置默认改为第 5 条）。

- [ ] **Step 2: README_CN.md 顶部加 quickstart 链接段**

在中文 README 顶部（标题之后）插入：

```markdown
## 快速上手

见 [README.md Quickstart](README.md#quickstart)。卡住了？运行 `npx opencode-cli-dispatch doctor` 自检。
```

- [ ] **Step 3: Record the demo (manual, optional but recommended)**

```bash
# 终端 1：asciinema 录一次 /claude hello 委派全过程
asciinema rec docs/demo.cast
# 转成 svg 嵌入 README Quickstart 顶部：
#   svg-term --cast docs/demo.cast --out docs/demo.svg --width 80
# README Quickstart 第一行加：![demo](docs/demo.svg)
```

- [ ] **Step 4: E2E acceptance (manual, required before release)**

按 spec 成功标准执行并记录耗时：

```bash
# 用临时 HOME 模拟干净环境
export TMPHOME=$(mktemp -d)
HOME=$TMPHOME bun add opencode-cli-dispatch   # 或按 Quickstart 步骤
# 计时：从第一步到 /claude hello 在 opencode 里成功返回 ≤ 5 分钟
# 过程中 doctor 必须能定位任何人为制造的故障（注销 plugin 声明、移走二进制各试一次）
```

- [ ] **Step 5: Commit**

```bash
git add README.md README_CN.md docs/
git commit -m "docs: add quickstart, split long-form docs into docs/ (A4)"
```

---

## Self-Review 记录

- **Spec 覆盖**：A1→Task 1，A2→Task 2/3/4，A3→Task 5，A4（npm/CI/README/E2E）→Task 6/7。spec 的"错误处理原则"逐条落在：Task 1（无效配置显式报错）、Task 2（`safe()` 包装不中断、fixHint 全覆盖）、Task 5（写命令失败降级警告）、Task 6（publish 失败由 CI 日志 + npm 报错呈现）。
- **类型一致性**：`DoctorContext`/`CheckResult`/`runChecks`/`applyFixes`/`formatResults`/`makeDoctorTool` 签名在 Task 2-4 间一致；`getConfigSearchPaths`（Task 1）被 Task 2 消费，参数序一致。
- **已收窄项**：doctor `--fix` 的 plugin-registered 修复只处理无注释的 `opencode.json`（JSON.parse 可解）；`.jsonc` 只给 fixHint——与 spec"可交互写入"一致地降级为自动写入，免交互。
