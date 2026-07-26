# 加固 opencode-cli-dispatch 插件加载 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 消除 `/cc`、`/codex` 委派时 "claude_start is unavailable" 类报错：命令模板加工具护栏、版本钉死、doctor 增加插件加载与兼容性检查、切换到 git 包加载方式。

**Architecture:** 不改委派架构。在 `src/commands.ts` 的命令模板中加入"先检查工具是否存在"护栏；`src/doctor/checks.ts` 新增两个检查（插件工具注册模拟、opencode 兼容性）；package.json 钉死 `@opencode-ai/plugin` 并加 `prepare` 脚本；最后把全局 opencode.json 切换到 git 包引用并删除 wrapper。

**Tech Stack:** TypeScript (tsc 构建到 dist/，dist 已提交 git)、Bun（测试与运行）、OpenCode plugin API (`@opencode-ai/plugin`)。

**Spec:** `docs/superpowers/specs/2026-07-26-harden-plugin-loading-design.md`

## Global Constraints

- 测试命令：`bun test`（在 `/Users/hassan/Documents/mcpOC` 下运行）。
- 构建命令：`bun run build`（tsc）；dist/ 目录已提交 git，改完源码必须重新构建并一并提交 dist。
- 提交信息风格：`feat:` / `fix:` / `docs:` / `test:` 前缀（参照 git log）。
- `@opencode-ai/plugin` devDependencies 钉为精确版本 `1.18.4`；peerDependencies 保持 `>=1.18.0`。
- 生成的命令模板为英文（与现有模板一致）；面向用户的中继提示用中文。
- `/opencode` 命令不加护栏（它是退出命令，不调用委派工具）。

---

### Task 1: 命令模板加入工具可用性护栏

**Files:**
- Modify: `src/commands.ts:9-25`（`DELEGATE_COMMAND_TEMPLATE`）
- Test: `src/__tests__/commands.test.ts`

**Interfaces:**
- Consumes: 现有 `generateCommands(config: CliDispatchConfig, outputDir: string): void`、`GENERATED_MARKER`（`src/policy.ts`）。
- Produces: 更新后的 `DELEGATE_COMMAND_TEMPLATE`；所有生成的 `{name}.md` 与 `cc.md` 都包含护栏段（Task 6 的 doctor `slash-commands` 检查会据此判断全局命令文件是否过期）。

- [ ] **Step 1: Write the failing test**

在 `src/__tests__/commands.test.ts` 的 `describe("generateCommands", ...)` 块内追加：

```ts
  it("includes a tool-availability guard in every delegate command", () => {
    generateCommands(configWith("claude", "codex"), dir)

    const claude = readFileSync(join(dir, "claude.md"), "utf-8")
    expect(claude).toContain("Tool availability check")
    expect(claude).toContain("claude_start")
    expect(claude).toContain("restart opencode")

    const cc = readFileSync(join(dir, "cc.md"), "utf-8")
    expect(cc).toContain("Tool availability check")
    expect(cc).toContain("claude_start")

    const codex = readFileSync(join(dir, "codex.md"), "utf-8")
    expect(codex).toContain("Tool availability check")
    expect(codex).toContain("codex_start")
  })

  it("does not add the guard to the /opencode exit command", () => {
    generateCommands(configWith("claude"), dir)
    const content = readFileSync(join(dir, "opencode.md"), "utf-8")
    expect(content).not.toContain("Tool availability check")
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/__tests__/commands.test.ts`
Expected: FAIL — `expect(content).toContain("Tool availability check")` 不成立。

- [ ] **Step 3: Implement the guard in the template**

修改 `src/commands.ts` 的 `DELEGATE_COMMAND_TEMPLATE`，在 `${GENERATED_MARKER}` 之后、"Delegate this conversation" 之前插入护栏段：

```ts
const DELEGATE_COMMAND_TEMPLATE = `---
description: {{DESCRIPTION}}
delegate: {{NAME}}
---

${GENERATED_MARKER}

**Tool availability check (do this first):** if the \`{{NAME}}_start\` tool is not among your available tools, the cli-dispatch plugin is not loaded in this session (the session likely started before the plugin was installed or updated). Tell the user exactly this: "委派插件未加载：当前会话早于插件安装/更新，请退出并重启 opencode 后重试 /{{NAME}}。" Then stop — do not answer the delegated message yourself.

Delegate this conversation to the {{NAME}} CLI.
`
```

（省略号部分保持原模板其余内容不变，仅插入护栏段。）

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test src/__tests__/commands.test.ts`
Expected: PASS（含两个新测试）。

Run: `bun test`
Expected: 全部 PASS（模板变化可能影响 hooks.test.ts 等断言模板内容的测试；若有失败，按新模板更新断言，属于预期内变更）。

- [ ] **Step 5: Rebuild dist and commit**

```bash
bun run build
git add src/commands.ts src/__tests__/commands.test.ts dist/commands.js dist/commands.js.map dist/commands.d.ts
git commit -m "feat: add tool-availability guard to delegate command templates"
```

---

### Task 2: 版本钉死与 prepare 脚本

**Files:**
- Modify: `package.json`
- Modify: `bun.lock`（由 bun install 重新生成）
- Modify: `cli-dispatch.config.README.md`（补充重启说明）

**Interfaces:**
- Consumes: 无（纯配置任务）。
- Produces: `package.json` scripts 含 `"prepare": "bun run build"`；devDependencies 中 `@opencode-ai/plugin` 为 `"1.18.4"`（Task 3 的 doctor 版本检查读取此值作对比基准）。

- [ ] **Step 1: Pin the plugin API version and add prepare**

`package.json` 修改两处：

```json
  "scripts": {
    "build": "tsc",
    "dev": "tsc --watch",
    "clean": "rm -rf dist",
    "test": "bun test",
    "prepare": "bun run build"
  },
```

```json
  "devDependencies": {
    "typescript": "^5.4.0",
    "@types/bun": "latest",
    "@opencode-ai/plugin": "1.18.4"
  },
```

`peerDependencies` 保持 `"@opencode-ai/plugin": ">=1.18.0"` 不变。

- [ ] **Step 2: Refresh lockfile and verify build + tests**

```bash
bun install
bun run build
bun test
```

Expected: install 成功；build 无错误；测试全 PASS。

- [ ] **Step 3: Document the restart requirement**

`cli-dispatch.config.README.md` 的 "Recovery" 小节之前插入：

```markdown
## After installing or updating the plugin

opencode loads plugins once at startup. After installing or updating
opencode-cli-dispatch (or regenerating slash commands), quit and restart
opencode. Long-running sessions started before an update will not have the
`claude_start` / `codex_start` tools; the `/cc` and `/codex` commands detect
this and tell you to restart.
```

- [ ] **Step 4: Commit**

```bash
git add package.json bun.lock cli-dispatch.config.README.md
git commit -m "build: pin @opencode-ai/plugin to 1.18.4 and build on prepare"
```

---

### Task 3: doctor 新增「插件工具注册模拟」检查

**Files:**
- Modify: `src/doctor/checks.ts`（新增 `checkPluginTools` 并在 `runChecks` 中注册）
- Test: `src/__tests__/doctor-checks.test.ts`

**Interfaces:**
- Consumes: `createCliDispatchPlugin`（`src/index.ts:20`）、`DoctorContext`（`src/doctor/context.ts`）、`CheckResult`（同文件内既有接口）、`resolveConfigPath`/`loadConfigForContext`（checks.ts 既有私有函数）。
- Produces: 新 CheckResult id `"plugin-tools"`，label `"Plugin tools"`；在 `runChecks` 返回数组中位于 `"plugin-registered"` 之后。`applyFixes` 不处理该 id（无自动修复）。

- [ ] **Step 1: Write the failing test**

在 `src/__tests__/doctor-checks.test.ts` 中（参照现有用例的 context 构造方式，`makeContext({ cwd, homeDir, pathEnv })`，tmp 目录）追加：

```ts
import { runChecks } from "../doctor/checks"

it("plugin-tools check passes and lists delegate tools", async () => {
  const results = await runChecks(ctx, async () => ({ ok: true, detail: "ok" }))
  const tools = results.find((r) => r.id === "plugin-tools")
  expect(tools).toBeDefined()
  expect(tools!.ok).toBe(true)
  expect(tools!.detail).toContain("claude_start")
  expect(tools!.detail).toContain("claude_reply")
  expect(tools!.detail).toContain("claude_check")
})
```

（`ctx` 的具体构造沿用该测试文件既有 fixture；若该文件用的是不同辅助函数，照搬其写法。run 参数传一个永远成功的假 RunDelegateFn，跳过真实 CLI 调用。）

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/__tests__/doctor-checks.test.ts`
Expected: FAIL — `tools` 为 undefined。

- [ ] **Step 3: Implement checkPluginTools**

在 `src/doctor/checks.ts` 中（`checkPluginRegistered` 之后）新增：

```ts
async function checkPluginTools(ctx: DoctorContext, config: CliDispatchConfig): Promise<CheckResult> {
  const { createCliDispatchPlugin } = await import("../index.js")
  const configPath = resolveConfigPath(ctx)
  const hooks = await createCliDispatchPlugin(configPath)({} as Parameters<ReturnType<typeof createCliDispatchPlugin>>[0])
  const registered = Object.keys(hooks.tool ?? {})
  const expected = Object.keys(config.delegates).flatMap((n) => [`${n}_start`, `${n}_reply`, `${n}_check`])
  const missing = expected.filter((t) => !registered.includes(t))
  if (missing.length === 0) {
    return { id: "plugin-tools", label: "Plugin tools", ok: true, detail: `registered: ${registered.join(", ")}` }
  }
  return {
    id: "plugin-tools",
    label: "Plugin tools",
    ok: false,
    detail: `tools missing after simulated load: ${missing.join(", ")}`,
    fixHint: "Rebuild the plugin (bun run build) and re-run doctor. If it persists, check that dist/ is up to date with src/.",
  }
}
```

并在 `runChecks` 中 `results.push(await safe("plugin-registered", ...))` 之后插入：

```ts
  results.push(await safe("plugin-tools", "Plugin tools", () => checkPluginTools(ctx, config)))
```

注意：`config` 变量在 runChecks 里于 config-file 检查之后才赋值——把该 push 放到 config 加载之后（与 `delegate-binaries` 同区域）。

- [ ] **Step 4: Run tests**

Run: `bun test src/__tests__/doctor-checks.test.ts`
Expected: PASS。

Run: `bun test`
Expected: 全部 PASS。

- [ ] **Step 5: Rebuild and commit**

```bash
bun run build
git add src/doctor/checks.ts src/__tests__/doctor-checks.test.ts dist/doctor/
git commit -m "feat: doctor check that simulates plugin load and lists registered tools"
```

---

### Task 4: doctor 新增「OpenCode 兼容性」检查

**Files:**
- Modify: `src/doctor/checks.ts`（新增 `checkOpencodeCompat` 并在 `runChecks` 中注册）
- Test: `src/__tests__/doctor-checks.test.ts`

**Interfaces:**
- Consumes: `which`（checks.ts 既有导出）、`ctx.pathEnv`；读取本包 `package.json` 的 `devDependencies["@opencode-ai/plugin"]` 作为支持基准（Task 2 钉为 `1.18.4`）。
- Produces: 新 CheckResult id `"opencode-compat"`，label `"OpenCode compatibility"`；`applyFixes` 不处理。opencode 不在 PATH 时返回 ok:true 且 detail 注明 skipped。

- [ ] **Step 1: Write the failing test**

```ts
it("opencode-compat check is present and never crashes without opencode", async () => {
  const emptyPathCtx = makeContext({ cwd, homeDir, pathEnv: "" })
  const results = await runChecks(emptyPathCtx, async () => ({ ok: true, detail: "ok" }))
  const compat = results.find((r) => r.id === "opencode-compat")
  expect(compat).toBeDefined()
  expect(compat!.ok).toBe(true)
  expect(compat!.detail).toContain("skipped")
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/__tests__/doctor-checks.test.ts`
Expected: FAIL — `compat` 为 undefined。

- [ ] **Step 3: Implement checkOpencodeCompat**

`src/doctor/checks.ts` 顶部 import 增加 `spawnSync`（来自 `child_process`）与 `fileURLToPath`（来自 `url`），然后新增：

```ts
function ownPackageJsonPath(): string {
  // dist/doctor/checks.js → 包根 package.json
  return fileURLToPath(new URL("../../package.json", import.meta.url))
}

function checkOpencodeCompat(ctx: DoctorContext): CheckResult {
  if (!which("opencode", ctx.pathEnv)) {
    return { id: "opencode-compat", label: "OpenCode compatibility", ok: true, detail: "opencode not on PATH; skipped" }
  }
  const res = spawnSync("opencode", ["--version"], { encoding: "utf-8" })
  const opencodeVersion = (res.stdout ?? "").trim()
  if (!/^\d+\.\d+\.\d+/.test(opencodeVersion)) {
    return { id: "opencode-compat", label: "OpenCode compatibility", ok: true, detail: `could not parse opencode version (${opencodeVersion}); skipped` }
  }
  const pkg = JSON.parse(readFileSync(ownPackageJsonPath(), "utf-8"))
  const supported: string = pkg.devDependencies?.["@opencode-ai/plugin"] ?? ""
  const [oMaj, oMin] = opencodeVersion.split(".")
  const [sMaj, sMin] = supported.replace(/^[^\d]*/, "").split(".")
  if (oMaj === sMaj && oMin === sMin) {
    return { id: "opencode-compat", label: "OpenCode compatibility", ok: true, detail: `opencode ${opencodeVersion} matches plugin API ${supported}` }
  }
  return {
    id: "opencode-compat",
    label: "OpenCode compatibility",
    ok: false,
    detail: `opencode ${opencodeVersion} vs plugin API ${supported} (minor mismatch)`,
    fixHint: `Align the devDependency: set "@opencode-ai/plugin" to "${opencodeVersion}" in package.json, run bun install && bun run build, then restart opencode.`,
  }
}
```

在 `runChecks` 中 `"plugin-tools"` 之后插入：

```ts
  results.push(await safe("opencode-compat", "OpenCode compatibility", () => checkOpencodeCompat(ctx)))
```

- [ ] **Step 4: Run tests**

Run: `bun test src/__tests__/doctor-checks.test.ts && bun test`
Expected: 全部 PASS。

- [ ] **Step 5: Rebuild and commit**

```bash
bun run build
git add src/doctor/checks.ts src/__tests__/doctor-checks.test.ts dist/doctor/
git commit -m "feat: doctor check for opencode/plugin-API version alignment"
```

---

### Task 5: 发布并切换全局配置（部署与验收）

**Files:**
- Modify（仓库外，用户环境）: `~/.config/opencode/opencode.json`
- Delete（仓库外，用户环境）: `~/.config/opencode/plugins/opencode-cli-dispatch.ts`

**Interfaces:**
- Consumes: Task 1-4 的全部产出（已推送的 git remote、新命令模板、doctor 新检查）。
- Produces: 生效中的稳定委派环境；验收记录。

- [ ] **Step 1: Push to GitHub**

```bash
git push origin master
```

Expected: 远端 TurboSnails/OpenCodePlugin 包含 Task 1-4 的提交。

- [ ] **Step 2: Switch opencode.json to the git package**

编辑 `~/.config/opencode/opencode.json` 为：

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": [
    "superpowers@git+https://github.com/obra/superpowers.git",
    "opencode-cli-dispatch@git+https://github.com/TurboSnails/OpenCodePlugin.git"
  ]
}
```

- [ ] **Step 3: Remove the wrapper**

```bash
rm ~/.config/opencode/plugins/opencode-cli-dispatch.ts
```

- [ ] **Step 4: Regenerate global slash commands**

```bash
bun run build && bunx --bun ./dist/doctor/cli.js --fix
```

（或全局可用的 `cli-dispatch doctor --fix`。）
Expected: `slash-commands` 检查从 stale 变为 ok，detail 显示 regenerated。

- [ ] **Step 5: Run full doctor**

```bash
bunx --bun ./dist/doctor/cli.js
```

Expected: 全部检查 ok，包括 `plugin-registered`（detail: declared in opencode.json）、`plugin-tools`（registered: claude_start, claude_reply, claude_check, codex_start, codex_reply, codex_check）、`opencode-compat`。

- [ ] **Step 6: Restart opencode and accept manually**

退出并重启 opencode，然后：
1. `/cc hello` — 完成一次 Claude 委派并返回；
2. 不带前缀追问一句 — 仍路由到 Claude（sticky）；
3. `/opencode` — 退出委派；
4. （可选）在未加载插件的旧会话中 `/cc` — 输出"请退出并重启 opencode"指引而非 "unavailable in this environment"。

- [ ] **Step 7: Commit any residual changes**

```bash
git status --short
git add -A && git commit -m "chore: post-deployment residuals" || true
```

---

## Self-Review 记录

- **Spec coverage：** 打包/加载 → Task 2 + Task 5；命令护栏 → Task 1；版本钉死 → Task 2；doctor 两项新检查 → Task 3、4；README 重启说明 → Task 2 Step 3；手动验收清单 → Task 5 Step 6。无遗漏。
- **Placeholder scan：** Task 3 Step 1 的 ctx 构造注明"沿用既有 fixture"，因为执行者需读 doctor-checks.test.ts 现有写法——这是有意指引而非占位符；其余步骤均含完整代码。
- **Type consistency：** CheckResult id 字符串（`plugin-tools`、`opencode-compat`）在测试与实现中一致；`checkPluginTools(ctx, config)`、`checkOpencodeCompat(ctx)` 签名在注册点一致。
