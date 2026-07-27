# Doctor 模块重构与测试加固 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 405 行的 `src/doctor/checks.ts` 按职责拆成四个聚焦文件（行为不变、向后兼容），并系统性隔离测试对真实 home 的写入、补齐两个 doctor 检查的失败分支测试。

**Architecture:** 新建 `check-utils.ts`（共享类型/helper）+ `env-checks.ts` / `delegate-checks.ts` / `command-checks.ts` 三个检查模块，`checks.ts` 退化为编排层（`runChecks`/`applyFixes`）并保持原有再导出，import 方向单向：context ← check-utils ← 检查模块 ← checks。

**Tech Stack:** TypeScript (tsc → dist/，dist 提交 git)、Bun（`bun test`）。

**Spec:** `docs/superpowers/specs/2026-07-26-doctor-refactor-design.md`

## Global Constraints

- 测试命令：`bun test`（在 `/Users/hassan/Documents/mcpOC` 下运行）；当前基线 **307 pass / 0 fail**。
- 构建命令：`bun run build`；dist/ 已提交 git，改源码必须重建并一并提交 dist。
- 提交信息风格：`feat:` / `fix:` / `docs:` / `test:` / `refactor:` 前缀。
- 不新增代码注释（移动代码时保留其原有注释）。
- 向后兼容：`src/doctor/format.ts`、`src/doctor/tool.ts`、`src/__tests__/doctor-checks.test.ts`、`src/__tests__/doctor-format.test.ts` 的 import 语句不得需要修改。
- Task 1 是纯重构：不得改变任何 CheckResult 的 id/label/detail/fixHint 文本与检查顺序。

---

### Task 1: 拆分 checks.ts 为聚焦模块

**Files:**
- Create: `src/doctor/check-utils.ts`
- Create: `src/doctor/env-checks.ts`
- Create: `src/doctor/delegate-checks.ts`
- Create: `src/doctor/command-checks.ts`
- Modify: `src/doctor/checks.ts`（405 行 → 约 120 行编排层）
- Test: `src/__tests__/doctor-checks.test.ts`（不修改——用它证明重构无行为变化）

**Interfaces:**
- Consumes: `src/doctor/context.ts` 的 `DoctorContext`/`makeContext`；`../config` 的 `loadConfig, getConfigSearchPaths, DEFAULT_CONFIG, CliDispatchConfig`；`../health-check` 的 `checkDelegate, RunDelegateFn`；`../commands` 的 `generateCommands, GENERATED_MARKER`。
- Produces（后续任务与既有消费者依赖）：
  - `check-utils.ts` 导出：`CheckResult`（interface，含 `id, label, ok, detail, fixHint?`）、`PKG`、`resolveConfigPath(ctx): string | undefined`、`loadConfigForContext(ctx): CliDispatchConfig`、`ownPackageJsonPath(): string`、`globalCommandsDir(ctx): string`、`which(binary, pathEnv): boolean`
  - `env-checks.ts` 导出：`checkPluginRegistered(ctx): CheckResult`、`checkConfigFile(ctx): { result: CheckResult; config: CliDispatchConfig }`、`checkOpencodeCompat(ctx): CheckResult`、`fixPluginRegistration(r: CheckResult, ctx: DoctorContext): CheckResult`
  - `delegate-checks.ts` 导出：`checkBinaries(config, ctx): CheckResult`、`checkAuthenticated(config, ctx): CheckResult`、`checkWritability(config, run): Promise<CheckResult>`、`checkPluginTools(ctx, config, loadTools?): Promise<CheckResult>`（`loadTools` 参数本任务先预留为 `loadTools?: () => Promise<string[]>`，默认 `undefined` 时走现有动态 import 逻辑；Task 3 的测试会注入它）
  - `command-checks.ts` 导出：`checkSlashCommands(config, ctx): CheckResult`、`fixSlashCommands(r: CheckResult, ctx: DoctorContext): CheckResult`
  - `checks.ts` 导出：`runChecks(ctx, run): Promise<CheckResult[]>`、`applyFixes(results, ctx): CheckResult[]`，并再导出 `CheckResult`、`DoctorContext`、`makeContext`、`which`

- [ ] **Step 1: Record the baseline**

```bash
bun test 2>&1 | tail -4
```

Expected: `Ran 307 tests ... 0 fail`。记录通过数作为重构对照基线。

- [ ] **Step 2: Create `src/doctor/check-utils.ts`**

从 `src/doctor/checks.ts` **原样移动**以下代码（含其注释），并补齐每个文件所需的 import：

- `CheckResult` interface（现 checks.ts:12-18）
- `const PKG`（:22）
- `resolveConfigPath`（:24-27）、`loadConfigForContext`（:29-33）
- `ownPackageJsonPath`（:104-106）
- `globalCommandsDir`（:257-259）
- `execAccessFlag`（:166-168）、`which`（:170-195）

文件头部 import：

```ts
import { existsSync, readFileSync, accessSync, constants } from "fs"
import { join, delimiter, isAbsolute } from "path"
import { fileURLToPath } from "url"
import type { CliDispatchConfig } from "../config"
import { loadConfig, getConfigSearchPaths, DEFAULT_CONFIG } from "../config"
import type { DoctorContext } from "./context"
```

所有这些符号都用 `export`。

- [ ] **Step 3: Create the three check modules**

`src/doctor/env-checks.ts` —— 原样移动 `checkPluginRegistered`（checks.ts:35-69）、`checkConfigFile`（:137-164）、`checkOpencodeCompat`（:108-135），并把 `applyFixes` 中 `r.id === "plugin-registered"` 分支的逻辑（含 `stripJsoncComments`，:338-344 与 :358-398 区域）抽取为导出函数：

```ts
export function fixPluginRegistration(r: CheckResult, ctx: DoctorContext): CheckResult
```

（函数体 = applyFixes 中该分支的完整逻辑，成功/失败路径的返回对象原样保留。）

所需 import：`existsSync, readFileSync, readdirSync, writeFileSync`（fs）、`join`（path）、`spawnSync`（child_process）、`./check-utils` 的相应符号、`./context` 的 `DoctorContext`。

`src/doctor/delegate-checks.ts` —— 原样移动 `checkBinaries`（:197-212）、`checkAuthenticated`（:214-237）、`checkWritability`（:239-255）、`checkPluginTools`（:71-102），其中 `checkPluginTools` 签名改为：

```ts
export async function checkPluginTools(
  ctx: DoctorContext,
  config: CliDispatchConfig,
  loadTools?: () => Promise<string[]>,
): Promise<CheckResult> {
  const registered = loadTools
    ? await loadTools()
    : await (async () => {
        const { createCliDispatchPlugin } = await import("../index.js")
        const configPath = resolveConfigPath(ctx)
        const tmp = mkdtempSync(join(tmpdir(), "cli-dispatch-doctor-plugin-"))
        try {
          const hooks = await createCliDispatchPlugin(configPath, { commandsDir: tmp })(
            {} as Parameters<ReturnType<typeof createCliDispatchPlugin>>[0],
          )
          return Object.keys(hooks.tool ?? {})
        } finally {
          rmSync(tmp, { recursive: true, force: true })
        }
      })()
  const expected = Object.keys(config.delegates).flatMap((n) => [`${n}_start`, `${n}_reply`, `${n}_check`])
  // 其后 expected.length === 0 守卫、missing 计算与三个 return 分支原样保留
}
```

所需 import：`mkdtempSync, rmSync`（fs）、`join`（path）、`tmpdir`（os）、`../health-check` 的 `checkDelegate, RunDelegateFn`、`../config` 类型、`./check-utils`、`./context`。

`src/doctor/command-checks.ts` —— 原样移动 `checkSlashCommands`（:261-294），并把 applyFixes 中 `r.id === "slash-commands"` 分支（:350-357 区域）抽取为：

```ts
export function fixSlashCommands(r: CheckResult, ctx: DoctorContext): CheckResult
```

所需 import：`existsSync, readFileSync, readdirSync, mkdtempSync, rmSync`（fs）、`join`（path）、`tmpdir`（os）、`../commands` 的 `generateCommands, GENERATED_MARKER`、`../config` 类型、`./check-utils`、`./context`。

- [ ] **Step 4: Rewrite `src/doctor/checks.ts` as the orchestrator**

完整新内容（这是本任务唯一需要"新写"的代码，约 120 行）：

```ts
import type { CliDispatchConfig } from "../config"
import { loadConfig, getConfigSearchPaths, DEFAULT_CONFIG } from "../config"
import type { RunDelegateFn } from "../health-check"
import { makeContext, type DoctorContext } from "./context"
import {
  type CheckResult,
  loadConfigForContext,
  which,
} from "./check-utils"
import { checkPluginRegistered, checkConfigFile, checkOpencodeCompat, fixPluginRegistration } from "./env-checks"
import { checkBinaries, checkAuthenticated, checkWritability, checkPluginTools } from "./delegate-checks"
import { checkSlashCommands, fixSlashCommands } from "./command-checks"

export { makeContext, type DoctorContext } from "./context"
export { type CheckResult, which } from "./check-utils"

export async function runChecks(ctx: DoctorContext, run: RunDelegateFn): Promise<CheckResult[]> {
  // 函数体现有逻辑原样保留（checks.ts:296-336 的 safe()、plugin-registered、
  // config-file + loadConfigForContext try/catch、plugin-tools、opencode-compat、
  // delegate-binaries、cli-authenticated、writability-probe、slash-commands 的
  // 推送顺序一字不改）
}

export function applyFixes(results: CheckResult[], ctx: DoctorContext): CheckResult[] {
  return results.map((r) => {
    if (r.ok) return r
    if (r.id === "slash-commands") return fixSlashCommands(r, ctx)
    if (r.id === "plugin-registered") return fixPluginRegistration(r, ctx)
    return r
  })
}
```

注意：顶部 import 区中 `loadConfig, getConfigSearchPaths, DEFAULT_CONFIG` 仅当 runChecks 保留的现有逻辑用到时才保留（它现在用的是 `loadConfigForContext`，故这三个 import 应删除——以 tsc 无 unused 报错为准调整 import 列表）。

- [ ] **Step 5: Run tests — must match baseline exactly**

```bash
bun run build && bun test 2>&1 | tail -4
```

Expected: `Ran 307 tests ... 0 fail`（与 Step 1 基线完全一致；测试文件零修改）。

同时验证向后兼容消费者的类型：

```bash
bun run build 2>&1 | head -5
```

Expected: 无 TS 错误（format.ts、tool.ts 的 import 不经修改即通过编译即证明兼容）。

- [ ] **Step 6: Rebuild dist and commit**

```bash
bun run build
git add src/doctor/ dist/doctor/
git commit -m "refactor: split doctor checks into focused modules"
```

---

### Task 2: 测试真实 home 隔离审计与验证

**Files:**
- Modify: `package.json`（新增 script）
- Modify（按审计结果而定）: `src/__tests__/*.test.ts` 中任何缺失隔离的调用点
- Test: 全套件在伪造 HOME 下运行

**Interfaces:**
- Consumes: Task 1 的模块结构（与本任务基本正交）。
- Produces: package.json script `"test:isolated"`；审计结论列表（写入报告）。

- [ ] **Step 1: Audit for real-home writes**

```bash
grep -rn "createCliDispatchPlugin(" src/__tests__/ | grep -v "commandsDir"
grep -rn "makeContext(" src/__tests__/ | grep -v "homeDir"
grep -rn "homedir()" src/__tests__/
```

Expected: 前两条无输出（所有调用点都已隔离）；第三条只允许出现在 `doctor-checks.test.ts` 的 os-mock 回归测试中。任何命中即为待修复点：给 `createCliDispatchPlugin` 调用补 `{ commandsDir: join(<既有 tmp fixture>, "commands") }`，给 `makeContext` 补 tmp `homeDir`。

- [ ] **Step 2: Fix any audit hits**

对每个命中点应用上述规则修复（预期：零命中——index.test.ts 已在上轮修复；若确实零命中，在报告中注明并跳到 Step 3）。

- [ ] **Step 3: Add the isolated-HOME script**

`package.json` scripts 增加：

```json
    "test:isolated": "HOME=$(mktemp -d) bun test"
```

- [ ] **Step 4: Verify suite passes under a fake HOME**

```bash
bun run test:isolated 2>&1 | tail -4
```

Expected: `0 fail`，通过数与基线一致（307 + Task 1 后不变）。若有用例在伪 HOME 下失败，说明它隐式依赖真实 home——按 Step 2 规则修复后重跑。

同时确认真实 commands 目录未被触碰：

```bash
git -C ~/.config/opencode/commands status 2>/dev/null; ls ~/.config/opencode/commands/
```

Expected: 仅 `cc.md claude.md codex.md opencode.md`（无 myagent.md 等异物）。

- [ ] **Step 5: Commit**

```bash
git add package.json $(git status --short | awk '{print $2}' | grep '__tests__' || true)
git commit -m "test: verify suite isolation from real HOME"
```

（若无任何测试文件改动，只提交 package.json。）

---

### Task 3: doctor 检查失败分支测试

**Files:**
- Modify: `src/doctor/delegate-checks.ts`（Task 1 已预留 `loadTools` 注入参数，本任务仅在测试中使用，无需改源码——若 Task 1 未预留则补上签名）
- Test: `src/__tests__/doctor-checks.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `checkPluginTools(ctx, config, loadTools?: () => Promise<string[]>)`、`checkOpencodeCompat(ctx): CheckResult`；测试文件既有 fixture：`root/home/cwd/bin` 三个 tmp 目录、`ctx(overrides)`、`run(ctx)`、`writeFakeBinary(dir, name)`、`byId(results, id)`、`stubRun`。
- Produces: 三个新测试用例（下方 Step 1 完整代码）；无新源码接口。

- [ ] **Step 1: Write the failing tests**

在 `src/__tests__/doctor-checks.test.ts` 末尾追加新 describe 块：

```ts
describe("failure branches", () => {
  it("plugin-tools fails loudly when delegate tools are missing after simulated load", async () => {
    writeFileSync(join(cwd, "cli-dispatch.config.json"), JSON.stringify({
      delegates: {
        claude: { binary: "claude", parser: "claude", startArgs: ["{prompt}"], replyArgs: ["{prompt}"] },
      },
    }))
    const { checkPluginTools } = await import("../doctor/delegate-checks")
    const config = { delegates: { claude: { binary: "claude", parser: "claude" as const, startArgs: ["{prompt}"], replyArgs: ["{prompt}"] } } }
    const result = await checkPluginTools(ctx(), config, async () => ["claude_start"])
    expect(result.ok).toBe(false)
    expect(result.detail).toContain("claude_reply")
    expect(result.detail).toContain("claude_check")
    expect(result.fixHint).toContain("bun run build")
  })

  it("opencode-compat fails with fixHint when opencode minor version differs", async () => {
    const path = join(bin, "opencode")
    writeFileSync(path, "#!/bin/sh\necho 9.9.9\n")
    chmodSync(path, 0o755)
    const results = await run(ctx())
    const compat = byId(results, "opencode-compat")
    expect(compat.ok).toBe(false)
    expect(compat.detail).toContain("9.9.9")
    expect(compat.fixHint).toContain("@opencode-ai/plugin")
  })

  it("opencode-compat skips gracefully on unparseable opencode output", async () => {
    const path = join(bin, "opencode")
    writeFileSync(path, "#!/bin/sh\necho garbage\n")
    chmodSync(path, 0o755)
    const results = await run(ctx())
    const compat = byId(results, "opencode-compat")
    expect(compat.ok).toBe(true)
    expect(compat.detail).toContain("skipped")
  })
})
```

注意：第二个测试的 fixHint 会提示把 devDependency 改成 `9.9.9`——这只在断言 `@opencode-ai/plugin` 字样，不断言具体建议版本。

- [ ] **Step 2: Run tests to verify they fail/pass as expected**

```bash
bun test src/__tests__/doctor-checks.test.ts 2>&1 | tail -6
```

Expected: 若 Task 1 已带上 `loadTools` 参数，第一个测试直接 PASS（它覆盖的是既有逻辑）；若签名不存在则编译错误——回到 Task 1 Step 3 补上签名。三个测试应全部 PASS；第一个若 FAIL 说明注入路径未生效。

- [ ] **Step 3: Run full suite**

```bash
bun test 2>&1 | tail -4
```

Expected: `0 fail`，总数 = 307 + 3 = 310。

- [ ] **Step 4: Rebuild dist (only if source changed) and commit**

```bash
bun run build
git add src/__tests__/doctor-checks.test.ts src/doctor/ dist/doctor/
git commit -m "test: cover plugin-tools and opencode-compat failure branches"
```

（若源码无改动，`git add` 只含测试文件。）

---

## Self-Review 记录

- **Spec coverage：** 拆分 → Task 1；真实 home 隔离 → Task 2；失败分支测试 → Task 3。spec 中"范围外"两项（os-mock 重写、generateCommands 漂移优化）不进本计划。无遗漏。
- **Placeholder scan：** Task 1 Step 3/4 用"原样移动 + 行号锚点"表达（重构任务的标准做法，行号基于当前 HEAD 的 checks.ts 实测）；Step 4 的 runChecks 函数体标注"现有逻辑原样保留"是有意为之——编排逻辑已存在且被 307 测试锁定，重写只会引入风险。Task 1 Step 3 的 checkPluginTools 给出完整新签名与默认实现代码。无 TBD/TODO。
- **Type consistency：** `loadTools?: () => Promise<string[]>` 在 Task 1（定义）与 Task 3（消费）签名一致；`fixPluginRegistration`/`fixSlashCommands` 的 `(r: CheckResult, ctx: DoctorContext): CheckResult` 在定义处与 applyFixes 调用处一致；测试注入的 config 字面量使用 `parser: "claude" as const` 以满足 `ParserName`。
