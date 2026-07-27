# Doctor 模块重构与测试加固 — 设计文档

日期：2026-07-26
状态：已获用户批准（优化建议清单第 5、6、8 项；第 7 项确认已实现，第 1-4 项已直接完成）

## 背景

加固插件加载（2026-07-26-harden-plugin-loading）完成后，遗留三项改进：

1. `src/doctor/checks.ts` 已 405 行、11 个函数，且还在增长——拆分；
2. 测试套件曾污染真实 `~/.config/opencode/commands`（index.test.ts 事件）——需要系统审计 + 隔离验证；
3. 两个新 doctor 检查只有 happy path 测试——补失败分支。

已确认无需做的：config 全局搜索路径（`src/config.ts` `getConfigSearchPaths` 已含 `~/.config/opencode/cli-dispatch.config.json` 兜底）。

## 设计

### 1. checks.ts 拆分（纯重构，行为不变）

按职责拆为四个文件，消除循环依赖（context.ts ← check-utils.ts ← 各检查模块 ← checks.ts）：

| 文件 | 职责 | 内容（从 checks.ts 原样移动） |
|---|---|---|
| `src/doctor/check-utils.ts` | 共享类型与helper | `CheckResult`、`PKG`、`resolveConfigPath`、`loadConfigForContext`、`ownPackageJsonPath`、`globalCommandsDir`、`execAccessFlag`、`which` |
| `src/doctor/env-checks.ts` | 环境/注册类检查 | `checkPluginRegistered`、`checkConfigFile`、`checkOpencodeCompat` + `stripJsoncComments` 与 applyFixes 的 plugin-registered 补丁逻辑（导出为 `fixPluginRegistration`） |
| `src/doctor/delegate-checks.ts` | delegate 行为检查 | `checkBinaries`、`checkAuthenticated`、`checkWritability`、`checkPluginTools` |
| `src/doctor/command-checks.ts` | 命令文件检查与修复 | `checkSlashCommands` + applyFixes 的 slash-commands 重生逻辑（导出为 `fixSlashCommands`） |
| `src/doctor/checks.ts` | 编排层 | `runChecks`、`applyFixes`（委托给 `fixPluginRegistration`/`fixSlashCommands`），并为向后兼容再导出：`CheckResult`、`DoctorContext`、`makeContext`、`which` |

向后兼容约束：`src/doctor/format.ts`（import CheckResult）、`src/doctor/tool.ts`（import runChecks）、`src/__tests__/doctor-checks.test.ts` 与 `doctor-format.test.ts` 的 import **全部不改**。

### 2. 测试真实 home 隔离（审计 + 验证）

- 审计规则：任何调用 `createCliDispatchPlugin` 的测试必须显式传 `{ commandsDir: <tmp> }`；任何 `makeContext`/`DoctorContext` 必须显式传 tmp `homeDir`/`pathEnv`。
- 端到端验证：`HOME=<tmp> bun test` 全套通过（posix 下 `os.homedir()` 读 `$HOME`），证明套件不触碰真实 home。
- package.json 增加 `"test:isolated": "HOME=$(mktemp -d) bun test"`。

### 3. 失败分支测试

- `checkPluginTools` 增加可选注入参数 `loadTools?: () => Promise<string[]>`（默认实现为现有的动态 import + tmp commandsDir 逻辑，返回注册工具名数组）；`runChecks` 调用处不传，签名向后兼容。测试注入返回部分工具的假 loader，断言 ok:false、detail 含缺失工具名、fixHint 指向 rebuild。
- `checkOpencodeCompat` mismatch/parse-miss 分支：沿用测试文件既有 `writeFakeBinary` 模式，在 tmp bin 目录放假 `opencode` 脚本（分别输出 `9.9.9` 与垃圾文本），`ctx({ pathEnv: bin })`，断言 mismatch → ok:false 且 detail/fixHint 含版本号；垃圾输出 → ok:true skipped。

### 测试与验收

- 拆分后既有 307 测试全部原样通过（重构证明）；
- `HOME=<tmp> bun test` 通过；
- 新增 3 个失败分支测试通过；`bun run build` 无错；dist 一并提交。

## 范围外（YAGNI）

- `mock.module("os")` 既有回归测试的注入式重写（已评审为可接受，套件并行化时再处理）；
- 插件 load 时 generateCommands 的"漂移才写"优化（架构层，另行评估）。
