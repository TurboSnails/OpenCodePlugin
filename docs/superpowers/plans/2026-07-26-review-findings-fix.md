# 修复双轴 review Spec 轴发现项 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 review 发现的三项 Spec 问题：`checkPluginTools` 默认 loader 的配置来源隔离、README 重启说明补齐、`checkOpencodeCompat` 的 Windows shim 解析。

**Architecture:** 三处独立小修：delegate-checks.ts 默认 loader 改为把已加载 config 序列化到 tmp 文件再传给工厂（公共 API 不变）；README.md/README_CN.md 各加一节；env-checks.ts 的 spawnSync 加 win32 shell 标志。

**Tech Stack:** TypeScript (tsc → dist/，dist 提交 git)、Bun（`bun test`）。

**Spec:** `docs/superpowers/specs/2026-07-26-review-findings-fix-design.md`

## Global Constraints

- 测试命令：`bun test`；当前基线 **310 pass / 0 fail**。
- 隔离验证：`bun run test:isolated`（HOME 为临时目录）也必须通过。
- 构建：`bun run build`；dist/ 已提交 git，改源码必须重建并一并提交 dist。
- 提交信息风格：`feat:` / `fix:` / `docs:` / `test:` 前缀。
- 不新增代码注释。
- 不得改变 `createCliDispatchPlugin` 的公共签名。

---

### Task 1: checkPluginTools 默认 loader 配置来源修复

**Files:**
- Modify: `src/doctor/delegate-checks.ts:1-28`
- Test: `src/__tests__/doctor-checks.test.ts`

**Interfaces:**
- Consumes: 既有 `checkPluginTools(ctx: DoctorContext, config: CliDispatchConfig, loadTools?: () => Promise<string[]>)`（签名不变）；测试文件既有 fixture `ctx()`（tmp 的 cwd/home，均不含任何 config 文件）。
- Produces: 修复后的默认 loader（序列化 config → tmp config.json → 传路径给工厂）；`resolveConfigPath` 从 delegate-checks.ts 的 import 中移除。

- [ ] **Step 1: Write the failing test**

在 `src/__tests__/doctor-checks.test.ts` 的 `describe("failure branches", ...)` 块内追加：

```ts
  it("plugin-tools simulated load uses the passed config, not ambient search paths", async () => {
    const { checkPluginTools } = await import("../doctor/delegate-checks")
    const config = {
      delegates: {
        ghost: { binary: "ghost", parser: "raw" as const, startArgs: ["{prompt}"], replyArgs: ["{prompt}"] },
      },
    }
    const result = await checkPluginTools(ctx(), config)
    expect(result.ok).toBe(true)
    expect(result.detail).toContain("ghost_start")
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/__tests__/doctor-checks.test.ts`
Expected: 新测试 FAIL —— `ctx()` 的搜索路径下无 config 文件，未修复的 loader 回落到进程 cwd（仓库根，含 claude+codex 的 `cli-dispatch.config.json`），注册的是 `claude_*`/`codex_*`，于是 `ghost_*` 全部 missing → ok:false。（若因运行目录不同意外 PASS，在该测试前加 `process.chdir(cwd)` 之类不可取——改为确认失败原因来自 ambient config 即可，报告实际输出。）

- [ ] **Step 3: Implement the fix**

`src/doctor/delegate-checks.ts` 三处编辑：

第 1 行 import 增加 `writeFileSync`：

```ts
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "fs"
```

第 7 行 import 移除 `resolveConfigPath`：

```ts
import { type CheckResult, which } from "./check-utils"
```

默认 loader（现 :16-28）替换为：

```ts
    : await (async () => {
        const { createCliDispatchPlugin } = await import("../index.js")
        const tmp = mkdtempSync(join(tmpdir(), "cli-dispatch-doctor-plugin-"))
        try {
          const configPath = join(tmp, "config.json")
          writeFileSync(configPath, JSON.stringify(config))
          const hooks = await createCliDispatchPlugin(configPath, { commandsDir: tmp })(
            {} as Parameters<ReturnType<typeof createCliDispatchPlugin>>[0],
          )
          return Object.keys(hooks.tool ?? {})
        } finally {
          rmSync(tmp, { recursive: true, force: true })
        }
      })()
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test src/__tests__/doctor-checks.test.ts && bun test 2>&1 | tail -3 && bun run test:isolated 2>&1 | tail -3`
Expected: 全部 PASS，总数 311；isolated 运行亦 0 fail。

- [ ] **Step 5: Rebuild dist and commit**

```bash
bun run build
git add src/doctor/delegate-checks.ts src/__tests__/doctor-checks.test.ts dist/doctor/
git commit -m "fix: source plugin-tools simulated load from passed config"
```

---

### Task 2: README 重启说明

**Files:**
- Modify: `README.md`（:28 "Stuck?" 段之后）
- Modify: `README_CN.md`（:9 快速上手段之后）
- Test: 无（文档任务；验收为 grep 断言）

**Interfaces:**
- Consumes: spec 第 2 节的定稿文案（英文与中文均已钉死，逐字使用）。
- Produces: 两个 README 各一个新小节。

- [ ] **Step 1: Insert the English section**

`README.md` 在 `**Stuck?** ...` 一段（:28）之后、`Full docs:` 行之前插入：

```markdown
## After installing or updating

opencode loads plugins once at startup. After installing or updating
opencode-cli-dispatch (or regenerating slash commands), quit and restart
opencode. Sessions started before an update won't have the
`claude_start` / `codex_start` tools — `/cc` and `/codex` detect this and
tell you to restart.
```

- [ ] **Step 2: Insert the Chinese section**

`README_CN.md` 在 `## 快速上手` 小节（:7-9）之后插入：

```markdown
## 安装或更新之后

opencode 只在启动时加载插件。安装或更新 opencode-cli-dispatch（或重新生成 slash 命令）后，请退出并重启 opencode。早于更新的会话不会有 `claude_start` / `codex_start` 工具——`/cc` 和 `/codex` 会检测到这一点并提示你重启。
```

- [ ] **Step 3: Verify**

Run: `grep -c "After installing or updating" README.md && grep -c "安装或更新之后" README_CN.md`
Expected: 各输出 `1`。

- [ ] **Step 4: Commit**

```bash
git add README.md README_CN.md
git commit -m "docs: add restart-after-update note to READMEs"
```

---

### Task 3: checkOpencodeCompat Windows shim 解析

**Files:**
- Modify: `src/doctor/env-checks.ts`（`checkOpencodeCompat` 的 spawnSync 调用，:47-52 区域）
- Test: `src/__tests__/doctor-checks.test.ts`（既有 3 个 compat 分支测试，不新增）

**Interfaces:**
- Consumes: 既有 `checkOpencodeCompat(ctx: DoctorContext): CheckResult`。
- Produces: spawnSync options 增加 `shell: process.platform === "win32"`；无签名变化。

- [ ] **Step 1: Apply the edit**

`src/doctor/env-checks.ts` 的 spawnSync 调用改为：

```ts
  const res = spawnSync("opencode", ["--version"], {
    encoding: "utf-8",
    timeout: 5000,
    env: { ...process.env, PATH: ctx.pathEnv },
    shell: process.platform === "win32",
  })
```

- [ ] **Step 2: Run the compat branch tests**

Run: `bun test src/__tests__/doctor-checks.test.ts`
Expected: 全部 PASS（PATH-miss、mismatch 9.9.9、garbage skip 三分支在 POSIX 下行为不变）。

- [ ] **Step 3: Full suite + build + commit**

```bash
bun test 2>&1 | tail -3 && bun run test:isolated 2>&1 | tail -3 && bun run build
git add src/doctor/env-checks.ts dist/doctor/
git commit -m "fix: resolve opencode .cmd/.bat shims on Windows in compat check"
```

Expected: 311 pass / 0 fail（两处运行）；tsc 无错。

---

## Self-Review 记录

- **Spec coverage：** 发现项 1（配置来源）→ Task 1；发现项 2（README）→ Task 2；发现项 3（Windows shim）→ Task 3。无遗漏；范围外项（Standards smells、方案 B）未混入。
- **Placeholder scan：** 无 TBD/TODO；Task 1 的测试与实现代码完整，Task 2 文案逐字来自 spec 定稿。
- **Type consistency：** `checkPluginTools` 签名三处（delegate-checks.ts、checks.ts 编排调用、测试动态 import）不变；`parser: "raw" as const` 满足 `ParserName`；`writeFileSync` 加入既有 fs import 行。
