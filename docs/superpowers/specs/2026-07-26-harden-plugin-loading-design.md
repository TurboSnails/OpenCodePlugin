# 加固 opencode-cli-dispatch 插件加载 — 设计文档

日期：2026-07-26
状态：已获用户批准（brainstorming 阶段）

## 背景与问题

用户频繁遇到 `/cc` 后模型报错：`claude_start is unavailable in this environment`。

### 已查明的根因

1. **旧会话从未加载插件**：opencode 只在启动时加载插件。出问题的会话进程（run 6e5db541）启动于 2026-07-22 14:21，而插件 wrapper 文件 14:22 才创建——该会话从未注册 `claude_start`。但全局静态命令 `/cc` 仍存在，指令注入了、工具却没有，模型只能报含糊的 "unavailable"。
2. **加载链间接**：当前通过 `~/.config/opencode/plugins/opencode-cli-dispatch.ts` wrapper + 绝对路径 import `~/.local/share/opencode-plugins/opencode-cli-dispatch/dist/index.js`，源码改后需手动 `bun run build`，易漂移。
3. **版本耦合风险**：`@opencode-ai/plugin` 与 opencode 版本不对齐时插件 API 漂移会静默失败（日志中 superpowers「Plugin export is not a function」、crg-plugin「app.on is not a function」均为同类问题）。

### 需求（用户明确）

保留委派模式：OpenCode 模型驾驶，`/cc` 切换到 Claude Code、`/codex` 切换到 Codex，处理完后切回。不要 Provider 插件式的全程替换。

## 设计

### 1. 打包与加载（核心改动）

- `~/.config/opencode/opencode.json` 的 `plugin` 数组直接引用 git 包：
  `"opencode-cli-dispatch@git+https://github.com/TurboSnails/OpenCodePlugin.git"`（与 superpowers 相同的加载模式）。
- 删除 wrapper 文件 `~/.config/opencode/plugins/opencode-cli-dispatch.ts`，消除绝对路径 import。
- package.json 增加 `prepare: "bun run build"`，opencode 安装/更新依赖时自动构建 dist，杜绝源码与 dist 漂移。
- 仓库即本仓库（mcpOC，remote: TurboSnails/OpenCodePlugin）；发布流程为 push 到 GitHub 后在 opencode 侧更新插件。

### 2. `/cc`、`/codex` 命令模板防护

- 修改 `src/commands.ts` 的 `generateCommands`，在生成的命令模板开头加入护栏指令，大意：
  > 先检查 `{name}_start` 工具是否存在。若不存在，告知用户：委派插件未加载（当前会话可能早于插件安装/更新），请重启 opencode 后重试；然后停止，不要尝试其他方式。
- 重新生成全局命令文件 `~/.config/opencode/commands/cc.md`、`codex.md`（及 `/opencode` 如适用）。
- 效果：旧会话遇到缺失工具时，用户得到明确可执行的指引，而非 "unavailable in this environment"。

### 3. 版本对齐与 doctor

- `@opencode-ai/plugin` 依赖版本与本机 opencode（当前 1.18.4）对齐并钉死（移除 `^` 浮动或使用精确版本）。
- 复用并扩展现有 doctor（`src/doctor/`，bin `cli-dispatch`）：确保覆盖以下检查——
  - 模拟插件加载并断言 6 个工具（`claude_start/reply/check`、`codex_start/reply/check`）注册成功；
  - `claude`、`codex` 二进制在 PATH 且可执行；
  - `cli-dispatch.config.json`（如存在）校验通过；
  - `@opencode-ai/plugin` 版本与当前 opencode 版本一致性。
- 文档（README / cli-dispatch.config.README.md）补充：安装/更新插件后必须重启 opencode。

### 4. 错误处理

- 保留 config 加载失败时的 `cli_dispatch_status` 降级工具（现有行为）。
- 插件整体未加载的场景无法注入工具（平台限制），由第 2 点的命令护栏兜底，向用户输出重启指引。
- claude 与 codex 两个 delegate 共享以上全部修复；claude-code-adapter / codex-adapter 使用共享模块，间接受益，但本次不改动宿主侧逻辑。

### 5. 测试与验证

- 现有 `bun test` 保持通过。
- 新增测试：生成的命令模板包含工具存在性检查护栏段。
- doctor 检查项有对应测试（参照 `src/doctor/` 现有测试结构）。
- 手动验收清单：
  1. 更新 opencode.json 引用 git 包并安装；
  2. 重启 opencode；
  3. `/cc hello` 完成一次委派并返回；
  4. 后续无前缀消息仍路由到 Claude（sticky routing）；
  5. `/opencode` 退出委派；
  6. 模拟插件未加载（旧会话），`/cc` 输出重启指引而非含糊报错。

## 范围外（YAGNI）

- Provider 插件兜底方案（用户已明确不需要全程 Claude Code 驱动）。
- claude-code-adapter / codex-adapter 宿主侧功能改造。
- 向 opencode 上游提插件热重载 feature request（可作为后续跟进）。

## 成功标准

- 新启动的 opencode 会话中 `/cc`、`/codex` 委派稳定可用；
- 旧会话中 `/cc` 失败时输出明确的「请重启 opencode」指引；
- `bun run doctor`（或 `cli-dispatch doctor`）一键诊断全部通过。
