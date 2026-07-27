# opencode-cli-dispatch 可靠性清理 — 设计文档

日期：2026-07-27
状态：已获用户批准（brainstorming 阶段）

## 背景与问题

当前委派链路已经可用：`cli-dispatch doctor` 全部检查通过，`opencode debug agent build` 中 `claude_start` / `claude_reply` 等工具也显示已注册。但用户仍会在旧会话里遇到 `/cc` 不可用，根因不是 claude CLI 缺失，也不是 `cli-dispatch.config.json` 损坏，而是：

1. **会话工具快照是启动时固定的**：插件安装/更新后，resume/continue 的旧会话不会刷新工具列表；模型只能看到启动时已有的工具。
2. **存在双注册风险**：全局 git 插件与本仓库 `.opencode/plugin/cli-dispatch.ts` 本地 dogfood wrapper 可同时注册，造成版本漂移和命令模板互相覆盖。
3. **文档与实际加载方式漂移**：`~/.config/opencode/README.md` 仍描述旧的 global wrapper 加载方式；本 repo 文档需要统一成当前推荐路径。

## 目标

做 **B：可靠性清理**。让委派功能在新会话稳定可用，在旧会话失败时给出可执行的明确指引，并用 doctor 检测/修复低风险配置问题。

非目标：不做 opencode 上游插件热重载；不改 sticky routing 的模型合规机制；不引入 provider 插件式全程替换。

## 设计

### 1. 加载/注册架构

- 正式加载源只保留全局 git 插件：`~/.config/opencode/opencode.json` 中的 `opencode-cli-dispatch@git+https://github.com/TurboSnails/OpenCodePlugin.git`。
- 本仓库 `.opencode/plugin/cli-dispatch.ts` 保留为开发入口，但默认不启用：只有当 `CLI_DISPATCH_DEV=1` 时才调用 `createCliDispatchPlugin()` 加载本地源码；否则返回空 hooks，避免与全局 git 插件双注册。
- `cli-dispatch doctor` 增加重复注册检查：当检测到全局 git 插件与本 repo 本地 wrapper 同时生效时报告 error，并输出具体文件路径与修复建议。
- `cli-dispatch doctor --fix` 只处理安全项：重新生成全局 slash commands；对内容匹配旧版 always-on dogfood wrapper 的 `.opencode/plugin/cli-dispatch.ts`，先备份再禁用为 `.disabled`。其他重复注册场景只报告，不自动改用户配置。

### 2. 旧会话体验与命令模板

- 修改 `src/commands.ts` 生成模板中的工具可用性 guard：如果 `{name}_start` 不在当前会话工具列表，明确输出：当前会话工具快照早于插件加载；请退出并启动全新 opencode 会话（不要 `--continue` / `--session` / resume；桌面 app 要完全 Quit），然后重试 `/<delegate>`；随后停止，不回答被委派的消息。
- `doctor` 校验 `~/.config/opencode/commands/{cc,claude,codex,opencode}.md` 是否由当前插件生成、guard 文案是否为最新版本；`--fix` 直接重生成这些全局 commands。
- 如果用户配置了 project-local `commandsDir`，doctor 提示该目录不受自动修复覆盖，不擅自修改项目命令文件。

### 3. 文档、错误处理、测试

- 更新 `~/.config/opencode/README.md`：删除过期的 global wrapper 描述，改为说明正式加载方式是全局 git 插件；本 repo 本地 wrapper 仅开发显式启用。
- 更新本 repo `docs/installation.md` 与 `docs/configuration.md`：统一说明全局 git 插件为正式加载方式；安装/更新插件后必须启动全新会话，resume/continue 的旧会话不会刷新工具。
- 错误处理保持分层：config 加载失败仍注册 `cli_dispatch_status` / `cli_dispatch_doctor`；插件完全未加载时由命令 guard 兜底；重复注册由 doctor 显式报错并给修复路径。
- 测试覆盖：commands guard 文案、commands 生成、doctor 重复注册检测、`--fix` 安全修复行为、本地 wrapper 默认 no-op / `CLI_DISPATCH_DEV=1` 启用行为；现有 `bun test` 保持通过。

## 成功标准

- 全新 opencode 会话中 `/cc`、`/codex` 可正常 start/reply，`/opencode` 可退出。
- 旧会话中 `/cc` 失败时输出“开全新会话，不要 resume”的明确指引，而不是含糊的工具不可用。
- `cli-dispatch doctor` 能检测重复注册、过期 commands、错误 wrapper；`--fix` 能安全修复命令模板和本 repo dogfood wrapper。
- 文档与实际加载方式一致，不再指向已删除/过期的 global wrapper 路径。
