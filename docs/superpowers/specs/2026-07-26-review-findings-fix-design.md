# 修复双轴 review 发现项（Spec 轴）— 设计文档

日期：2026-07-26
状态：已获用户批准（方案 A）

## 背景

2026-07-26 双轴 review（fixed point 8d0ae54）的 Spec 轴发现三项问题，本设计覆盖全部三项。Standards 轴 smell 经用户裁决不纳入本轮。

## 修复项

### 1. `checkPluginTools` 默认 loader 可能读到真实 HOME 的 config（缺陷，方案 A）

**问题**：`src/doctor/delegate-checks.ts` 的默认 loader 调用 `createCliDispatchPlugin(resolveConfigPath(ctx), …)`。当 ctx 下找不到 config 文件时 `resolveConfigPath` 返回 `undefined`，工厂内 `loadConfig(undefined)` 按进程 `homedir()` 重新搜索——模拟加载得到的工具清单可能来自与 runChecks 已加载 `config` 不同的配置，造成假的 "tools missing" 失败，也违背 doctor 只读 ctx 的隔离精神。

**修复（方案 A）**：默认 loader 在现有 mkdtemp 临时目录中把 `config` 参数序列化为 `config.json`，将该路径传给 `createCliDispatchPlugin`，保证模拟加载与被对比的 config 严格同源。不改 `createCliDispatchPlugin` 公共签名。

```
const tmp = mkdtempSync(...)
try {
  const configPath = join(tmp, "config.json")
  writeFileSync(configPath, JSON.stringify(config))
  const hooks = await createCliDispatchPlugin(configPath, { commandsDir: tmp })(...)
  ...
} finally { rmSync(tmp, ...) }
```

**注意**：`resolveConfigPath(ctx)` 的调用随之移除（不再需要——config 已由 runChecks 加载好）。

**测试**：新增用例——构造 ctx（其搜索路径下**无** config 文件）并显式传入含 claude delegate 的 config，断言 plugin-tools ok:true 且 detail 含 `claude_start`（修复前：loader 回落到真实/默认搜索路径，行为取决于环境，可能 false negative）。

### 2. README.md 补充重启说明（partial 补齐）

在 `README.md` 的 "Stuck?" 段落附近新增小节，与 `cli-dispatch.config.README.md` 已有内容呼应（英文，面向用户）：

```markdown
## After installing or updating

opencode loads plugins once at startup. After installing or updating
opencode-cli-dispatch (or regenerating slash commands), quit and restart
opencode. Sessions started before an update won't have the
`claude_start` / `codex_start` tools — `/cc` and `/codex` detect this and
tell you to restart.
```

同时检查 `README_CN.md` 对应位置补中文等价小节，文案：

```markdown
## 安装或更新之后

opencode 只在启动时加载插件。安装或更新 opencode-cli-dispatch（或重新生成 slash 命令）后，请退出并重启 opencode。早于更新的会话不会有 `claude_start` / `codex_start` 工具——`/cc` 和 `/codex` 会检测到这一点并提示你重启。
```

### 3. `checkOpencodeCompat` Windows shim 解析（minor）

`src/doctor/env-checks.ts` 的 `spawnSync("opencode", ["--version"], { … })` 增加 `shell: process.platform === "win32"`，使 `.cmd`/`.bat` shim 在 Windows 可解析（`which()` 已探测这些扩展名）。无 Windows CI，靠既有 POSIX 测试（PATH-miss、mismatch 9.9.9、garbage skip 三个分支）回归保证无破坏。

## 测试与验收

- 新增第 1 项的回归测试；既有 310 测试全部通过；
- `bun run test:isolated` 通过；
- `bun run build` 无错，dist 一并提交；
- 手动：`bun ./dist/doctor/cli.js` 8/8 通过。

## 范围外（YAGNI）

- Standards 轴 smell（candidates 去重、IIFE 命名、execAccessFlag 导出面、checkAuthenticated 级联）；
- `createCliDispatchPlugin` 接受 config 对象的 API 扩展（方案 B，留待真有第二个调用方需要时）。
