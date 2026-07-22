# Onboarding Sprint: 安装与首跑体验设计

**日期**：2026-07-22
**状态**：已确认（用户逐段批准）
**目标**：开源公开发布前，把"装上但用不起来"这一最大短板修到 **新用户 5 分钟内跑通首次委派**。

## 背景与问题

opencode-cli-dispatch 技术底座已成熟（verified-models 门控、健康检查、session 持久化、P0 可靠性加固），但获客漏斗最上游在漏：

1. **静默失败**：插件装在 `~/.config/opencode/plugins/` 但未在 `opencode.json` 声明时，工具不注册、`/cc` 掉链子，全程无任何提示（本项目一次真实会话中复现）。
2. **安装路径不顺畅**：未发布 npm，只能 git URL 或 tarball；slash commands 不随包分发，需手动 copy；配置文件按 `process.cwd()` 查找，全局安装时每个项目都要放配置。
3. **失败无引导**：出错后用户只能读源码排错。
4. **README 300 行**：新用户找不到最短路径；无 demo。

## 成功标准

干净环境（或临时 HOME）走 README Quickstart，**≤5 分钟**从 `bun add` 到 `/cc` 首次成功委派。发布前手工执行一次作为验收。

## 组件划分

四个模块，各自独立交付、独立测试，顺序 A1 → A2 → A3 → A4：

| 模块 | 职责 | 依赖 |
|---|---|---|
| A1 配置查找扩展 | 查找路径加 `~/.config/opencode/cli-dispatch.config.json` | 无 |
| A2 doctor 诊断 | 独立 CLI + 插件内工具，共享检查逻辑，支持 `--fix` | 复用 health-check、config 校验 |
| A3 命令自动注册 | 插件加载时幂等写入全局 commands 目录 | 现有 commands.ts |
| A4 发布流水线 | npm 发布 + CI + README 重排 | A1–A3 完成后 |

**关键决策**：A2 以插件外 CLI 为先——"插件未加载"这类致命故障只有外部诊断器能发现；插件内工具是装完后的补充。

## A1 配置查找扩展

`loadConfig` 的 searchPaths 在 cwd 相对路径之后、内置默认之前，插入 `~/.config/opencode/cli-dispatch.config.json`（`os.homedir()` 拼接）。

错误处理：全局配置文件存在但校验失败时，报错必须指明出错的具体路径（查找链多文件时用户易混）；找到无效配置即停下报错，**不静默 fallback** 到内置默认——配置错误应显式。

README Configuration 一节同步更新查找链。

## A2 doctor 诊断

### 检查项（按用户上手路径排序，第一个失败项即用户卡点）

| # | 检查项 | 失败时输出 |
|---|---|---|
| 1 | 插件已注册：项目级 + 全局级 `opencode.json(c)` 任一处声明 | 给出要添加的 JSON 片段 |
| 2 | 配置文件：查找链上第一个 config 校验通过；未找到则提示用内置默认 | 逐条校验错误 + 文件路径（复用 validateConfig） |
| 3 | delegate 二进制在 PATH（`claude`/`codex`） | 安装命令 |
| 4 | CLI 已登录：`~/.claude` 凭证 / codex auth 文件存在（不调 API） | 提示交互登录一次 |
| 5 | 可写性探针：temp 目录 spawn delegate（复用 health-check） | 指向配置文档权限段落 |
| 6 | slash commands 在 `~/.config/opencode/commands/` 且为最新 | `--fix` 自动重新生成 |

### 输出契约

- 每项一行：`✓ 插件已注册 (全局 opencode.json)` / `✗ delegate 二进制: claude 不在 PATH`
- 任一失败 → 退出码 1，第一个失败项下方直接给修复指令；全过 → 退出码 0 + "Run `/cc hello` in opencode to verify end-to-end."
- `--fix` 只修幂等可修的（#6 重新生成、#1 可交互写入 opencode.json），其余只报告
- 单项检查自身抛异常（如 opencode.json 语法错误）→ 该项记 `✗` 附异常摘要，**不中断后续检查**

### 实现

`src/doctor/` 子目录：检查器为纯函数数组 `(ctx) → CheckResult`，CLI 入口与插件内 `cli_dispatch_doctor` 工具共享检查逻辑，仅渲染不同（终端文本 vs 聊天消息）。

## A3 命令自动注册

插件加载时把 `/cc` `/codex` `/opencode` 等命令文件**幂等**写入 `~/.config/opencode/commands/`（生成内容一致则跳过写入）。

错误处理：目标目录无权限（如只读 HOME）→ 降级为警告并可在 doctor 复查，**不让插件加载失败**。

保留现有 `commandsDir` 选项行为不变（指定时写项目目录）。

## A4 发布流水线

### npm 发布

- 包名 `opencode-cli-dispatch`（`npm view` 确认可用；被占退 scope 名）
- `package.json` 补 `bin`：`"cli-dispatch": "./dist/doctor/cli.js"`；`files` 维持 `dist/` + 默认 config
-  semver 从 1.0.0 起，手动 `npm version` 打 tag，tag push 触发发布

### GitHub Actions

| 流水线 | 触发 | 步骤 |
|---|---|---|
| `ci.yml` | PR / push | bun install → bun test → bun run build → `git diff --exit-code dist/`（dist 与源码脱节即失败） |
| `publish.yml` | tag `v*` | CI 全套 → `npm publish --provenance`（token 存 repo secret） |

publish 失败（token 过期、版本已存在）时 CI 报错附修复链接。

### README 重排

1. 顶部 30 秒 Quickstart：GIF demo（asciinema → svg，展示 `/cc` 委派全过程）→ 三步（`bun add` → opencode.json 一行 → `/cc hello`）→ "卡住了？`npx opencode-cli-dispatch doctor`"
2. 现有长文档（安装 Option A/B/C、配置参考、Claude Code adapter）原样下沉 `docs/` 按主题拆分，README 只留 quickstart + 功能亮点 + 链接
3. 仓库元数据：GitHub description、topics（`opencode` `claude-code` `codex` `mcp` `plugin`）、CI/npm badge

## 测试策略

| 层 | 内容 |
|---|---|
| 单元（bun test，延续 `src/__tests__`） | A1 查找链顺序（临时 HOME 注入）；A2 各检查器纯函数（mock fs/PATH）；A3 幂等生成（跑两次 diff 为空） |
| 集成 | doctor CLI 临时 HOME 下全过 / 各失败场景（缺二进制、配置语法错误）退出码与输出断言 |
| 端到端验收 | 手工：干净环境走 Quickstart 计时 ≤5 分钟，发布前 checklist 执行 |

## 明确不做（YAGNI）

- 不自动安装 claude/codex 二进制、不替用户登录
- 不做交互式 setup wizard（doctor --fix 已覆盖可自动化部分）
- 不引入新运行时依赖（doctor 只用标准库 + 现有依赖）
- P1 留存深化（sticky 兜底、进度展示）与差异化功能（并行委派、交叉评审、成本统计）记入 backlog，本冲刺不做
