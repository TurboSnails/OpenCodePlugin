# opencode-cli-dispatch 实现文档

> 版本：`1.0.2`  
> 本文档描述当前 `opencode-cli-dispatch` 插件的整体实现方案、核心模块、数据流、安全策略与扩展方式。

---

## 1. 项目概述

`opencode-cli-dispatch` 是一个 **OpenCode 插件**，同时附带 **Claude Code 适配器**。它把 OpenCode/Claude Code 的对话委派给外部 CLI 编码代理（如 Claude Code、Codex、或其他可配置的 CLI），并把外部代理的输出流式地返回给宿主。

核心能力：

- **多代理并发配置**：可配置任意数量的 CLI 代理（`claude`、`codex`、`opencode`、自定义 `raw`）。
- **会话保持（sticky routing）**：一次委派后，后续消息自动路由到同一个外部代理，直到用户主动退出。
- **会话恢复**：每个外部代理维护自己的会话 ID，后续消息通过 `--resume` 或 `exec resume` 恢复，而不是重新启动新会话。
- ** slash 命令自动生成**：`/claude`、`/codex`、`/cc`、`/opencode` 等命令文件由插件自动写入 `~/.config/opencode/commands/`。
- **健康检查与诊断**：`{name}_check` 工具在隔离目录中验证外部代理能否写文件；`cli_dispatch_doctor` / `cli-dispatch doctor` 诊断安装链路。
- **模型校验门控**：`verifiedModels` 列表阻止未验证的模型启动委派，避免某些模型把命令模板当 prompt 转发。
- **CI / npm 自动发布**：GitHub Actions 跑测试、校验 `dist/` 同步、发布 npm 并自动创建 GitHub Release。

---

## 2. 整体架构

```
┌─────────────────────────────────────────────────────────────────┐
│                     OpenCode / Claude Code 宿主                  │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │ /claude      │  │ /codex       │  │ /opencode     │  slash  │
│  │ /cc (alias)  │  │              │  │ 退出命令     │  commands│
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘          │
│         │                 │                 │                   │
│         └─────────────────┴─────────────────┘                   │
│                           │                                     │
│              ┌────────────┴────────────┐                       │
│              │  hooks.ts                │                       │
│              │  - command.execute.before│                       │
│              │  - tool.execute.before   │                       │
│              │  - chat.message          │                       │
│              │  - experimental.chat.system.transform             │
│              └────────────┬────────────┘                       │
│                           │                                     │
│              ┌────────────┴────────────┐                       │
│              │  createCliDispatchPlugin │                       │
│              │  (index.ts)              │                       │
│              └──────┬─────────┬──────┘                       │
│                     │         │                                │
│        ┌────────────┘         └────────────┐                     │
│        │                                  │                     │
│   ┌────┴────┐                       ┌────┴────┐               │
│   │ delegate-tools.ts                │ health-check.ts          │
│   │ makeStartTool / makeReplyTool   │ makeCheckTool            │
│   └────┬────┘                       └────┬────┘               │
│        │                                  │                     │
│   ┌────┴────┐                       ┌────┴────┐               │
│   │ delegate-turn.ts                   │ checkDelegate          │
│   │ startDelegateTurn / reply...    │ 写文件探针              │
│   └────┬────┘                       └─────────┘               │
│        │                                                       │
│   ┌────┴────┐                                                 │
│   │ run-delegate.ts                                              │
│   │ spawn 子进程、解析 stdout 流、超时/取消/树杀                │
│   └────┬────┘                                                 │
│        │                                                       │
│   ┌────┴────┐  ┌────────────┐  ┌────────────┐                │
│   │ claude   │  │ codex      │  │ raw        │  外部 CLI       │
│   └──────────┘  └────────────┘  └────────────┘                │
└─────────────────────────────────────────────────────────────────┘
```

### 2.1 三个宿主入口

| 宿主 | 入口文件 | 集成方式 |
|---|---|---|
| **OpenCode** | `src/index.ts` 导出的 `createCliDispatchPlugin()` | 插件系统（`tool` + `hooks`） |
| **Claude Code** | `src/claude-code-adapter/` | MCP 服务器 + 本地 hooks（`.claude/settings.json`） |
| **Codex** | `src/codex-adapter/` | MCP 服务器（`config.toml`）+ hooks（`hooks.json`）+ 自定义 prompts |

三个宿主共享同一套核心逻辑：`config.ts`、`delegate-turn.ts`、`run-delegate.ts`、`parse-events.ts`、`session-store.ts`、`policy.ts` 等。

---

## 3. 模块职责

### 3.1 核心模块

| 文件 | 职责 | 关键导出 |
|---|---|---|
| `src/config.ts` | 配置加载、验证、默认配置、模型校验规则 | `loadConfig`, `getConfigSearchPaths`, `DEFAULT_CONFIG`, `matchesVerifiedModel` |
| `src/index.ts` | OpenCode 插件入口，注册 tools 与 hooks | `createCliDispatchPlugin`, `makeStatusTool` |
| `src/delegate-tools.ts` | 生成 `{name}_start` / `{name}_reply` 工具 | `makeStartTool`, `makeReplyTool` |
| `src/delegate-turn.ts` | 委派一次对话的协调逻辑：session 注册、参数解析、git diff 摘要 | `startDelegateTurn`, `replyDelegateTurn` |
| `src/run-delegate.ts` | 启动外部 CLI 子进程、流式解析 stdout、超时/取消/树杀 | `runDelegate`, `defaultSpawn` |
| `src/parse-events.ts` | 按 `claude` / `codex` / `opencode` / `raw` 解析 CLI 输出 | `getParser`, `LineParser` |
| `src/session-store.ts` | 内存 + 文件持久化委派状态 | `memoryDelegateStore`, `getActiveDelegate`, `setActiveDelegateIfLatest` |
| `src/commands.ts` | 根据配置生成 slash command markdown 文件 | `generateCommands` |
| `src/hooks.ts` | OpenCode hooks：路由注入、命令拦截、模型校验、prompt 清洗 | `makeSystemTransform`, `makeCommandBefore`, `makeToolExecuteBefore`, `makeChatMessage` |
| `src/health-check.ts` | 在隔离目录验证外部 CLI 可写文件 | `checkDelegate`, `makeCheckTool` |
| `src/policy.ts` | 安全策略原语：生成标记、session id 校验、argv 注入防护 | `GENERATED_MARKER`, `isValidExternalId`, `validateArgvInjection` |
| `src/worktree-summary.ts` | 每次委派前后对比 git worktree 变化 | `snapshotWorktree`, `buildChangeSummary` |
| `src/routing-rule.ts` | 生成注入 system prompt 的 sticky 路由规则 | `buildRoutingRule` |
| `src/doctor/` | 安装诊断（A2 sprint 新增） | `runChecks`, `applyFixes`, `formatResults`, `makeDoctorTool` |
| `src/claude-code-adapter/` | Claude Code 宿主适配（MCP server + hooks） | 见该目录下模块 |
| `src/codex-adapter/` | Codex 宿主适配（MCP server + hooks + prompts + setup CLI） | 见第 17 章 |

---

## 4. 配置系统

### 4.1 配置格式

`cli-dispatch.config.json` 示例：

```json
{
  "delegates": {
    "claude": {
      "binary": "claude",
      "parser": "claude",
      "startArgs": [
        "-p", "--output-format", "stream-json", "--verbose",
        "--permission-mode", "acceptEdits",
        "--session-id", "{sessionId}",
        "--", "{prompt}"
      ],
      "replyArgs": [
        "-p", "--output-format", "stream-json", "--verbose",
        "--permission-mode", "acceptEdits",
        "--resume", "{externalId}",
        "--", "{prompt}"
      ]
    },
    "codex": {
      "binary": "codex",
      "parser": "codex",
      "startArgs": [
        "exec", "--json", "-c", "sandbox_mode=workspace-write",
        "--skip-git-repo-check", "--", "{prompt}"
      ],
      "replyArgs": [
        "exec", "resume", "--json", "-c", "sandbox_mode=workspace-write",
        "--skip-git-repo-check", "--", "{externalId}", "{prompt}"
      ]
    }
  },
  "verifiedModels": [
    "kimi-for-coding/k3",
    "opencode/deepseek-v4-flash-free"
  ]
}
```

### 4.2 配置查找链

`loadConfig()` 按以下顺序查找，命中即停：

1. `createCliDispatchPlugin(configPath)` 显式传入的路径
2. `./cli-dispatch.config.json`（当前项目根）
3. `./.opencode/cli-dispatch.config.json`
4. `./.opencode/lib/cli-dispatch/config.json`
5. `~/.config/opencode/cli-dispatch.config.json`（全局，A1 sprint 新增）
6. 回退到内置 `DEFAULT_CONFIG`

`getConfigSearchPaths(configPath?, homeDir?, cwd?)` 被导出，供 doctor 复用同一查找逻辑。

### 4.3 验证规则

`validateConfig()` / `validateDelegates()` 校验：

- `delegates` 必须是对象。
- 每个 delegate name 必须匹配 `/^[\w-]+$/`，否则生成的工具名非法。
- `binary` 必须是字符串。
- `parser` 必须是 `claude` / `codex` / `opencode` / `raw`。
- `startArgs` 必须是字符串数组，且必须包含 `{prompt}`。
- `replyArgs` 必须是字符串数组；不含 `{externalId}` 时仅警告（raw 代理可能无 session 概念）。
- `timeoutMs` 必须是正数。
- `verifiedModels` 每一项必须是 `provider/model` 格式，可带尾部 `*` 通配。
- `validateArgvInjection()` 防止 argv 注入（见第 8 章）。

### 4.4 参数占位符解析

`resolveArgs(args, vars)` 做简单的字符串替换：

| 占位符 | 含义 | 出现位置 |
|---|---|---|
| `{prompt}` | 用户的实际消息 | `startArgs` 必填、`replyArgs` 必填 |
| `{sessionId}` | 客户端生成的会话 ID | `startArgs` 可选 |
| `{externalId}` | 外部 CLI 返回的会话 ID | `replyArgs` 可选 |

---

## 5. Doctor 诊断系统（A2 sprint）

设计目标：把“装上但用不起来”变成“运行一条命令就知道哪一步坏了”。

### 5.1 架构

```
src/doctor/
├── context.ts    # DoctorContext / makeContext
├── checks.ts     # 六项检查 + runChecks + applyFixes
├── format.ts     # 终端/聊天输出渲染
├── cli.ts        # 命令行入口（bun/node 双兼容包装）
├── run-cli.ts    # 实际跑检查的入口
└── tool.ts       # 插件内 cli_dispatch_doctor 工具
```

### 5.2 六项检查

`runChecks(ctx, run)` 按固定顺序返回 `CheckResult[]`：

| id | 检查项 | 说明 |
|---|---|---|
| `plugin-registered` | 插件是否已注册 | 检查 `opencode.json(c)` 或 `plugin/` 目录 wrapper 是否引用 `opencode-cli-dispatch` |
| `config-file` | 配置文件 | 按查找链加载配置，失败时返回具体错误路径 |
| `delegate-binaries` | 外部 CLI 是否在 PATH | 支持绝对路径；Windows 自动加 `.exe/.cmd/.bat` 后缀；使用 `F_OK` 而非 `X_OK` |
| `cli-authenticated` | CLI 是否已登录 | 检查 `~/.claude/.credentials.json` / `~/.claude.json` / `~/.codex/auth.json` |
| `writability-probe` | 可写性探针 | 在隔离目录 spawn 外部 CLI，要求它创建文件；复用 `checkDelegate` |
| `slash-commands` | slash 命令是否最新 | 比较 `~/.config/opencode/commands/` 中的生成文件与当前配置应生成的内容 |

### 5.3 `--fix` 自动修复

`applyFixes()` 只修幂等、安全的项：

- `slash-commands` 失败：重新生成命令文件到 `~/.config/opencode/commands/`。
- `plugin-registered` 失败：在存在的 `opencode.json` / `opencode.jsonc` 中追加 `opencode-cli-dispatch`。
  - `.jsonc` 通过正则剥除注释后 `JSON.parse` 修改；会丢失注释，并在输出中说明。
  - 如果 `.jsonc` 结构无法解析，降级为提示手动修改。
- 其他项（binary 缺失、CLI 未登录）只报告，不自动修复。

### 5.4 两个入口

| 入口 | 使用场景 | 实现 |
|---|---|---|
| `cli-dispatch doctor` | 命令行，尤其用于“插件没加载成功”时 | `src/doctor/cli.ts` 是 Node 兼容包装，检测到非 bun 时自动用 `bun` 重新执行；`src/doctor/run-cli.ts` 实际跑检查 |
| `cli_dispatch_doctor` 工具 | 插件已加载后，用户在聊天里快速自检 | `src/doctor/tool.ts` 包装 `runChecks` + `formatResults` |

---

## 6. Slash Command 生成（A3 sprint）

### 6.1 生成内容

`generateCommands(config, outputDir)` 生成 markdown 文件，每个文件包含：

- YAML frontmatter（`description`、`delegate` 等）
- `GENERATED_MARKER` 注释，用于识别“这是插件生成的文件”
- 指令正文：告诉模型何时调用 `{name}_start` / `{name}_reply`，何时用 `/opencode` 退出

生成文件包括：

- 每个 delegate 对应 `{name}.md`（如 `claude.md`、`codex.md`）
- 当配置中有 `claude` 时额外生成 `cc.md` 别名
- 始终生成 `opencode.md` 退出命令

### 6.2 幂等写入

`writeIfChanged(path, content)` 在文件内容完全一致时跳过写入，避免：

- 无意义地更新文件 mtime，导致 OpenCode 重新加载。
- 不必要的磁盘 I/O。

### 6.3 安全清理

生成完成后，会清理 outputDir 中的**旧生成文件**：

- 只删除包含 `GENERATED_MARKER` 的文件。
- 不包含 `GENERATED_MARKER` 的手工维护文件（如用户自己写的 `cc.md`）永远不会被删除或覆盖。

### 6.4 自动注册路径

`createCliDispatchPlugin()` 中：

```ts
const commandsDir = options?.commandsDir ?? join(homedir(), ".config", "opencode", "commands")
```

- 默认写入全局 commands 目录（npm 安装后开箱即用）。
- 保留 `commandsDir` 选项，供项目级自定义。
- 写入失败时仅 `console.warn`，不阻塞插件加载。

---

## 7. 委派会话流程

### 7.1 首次委派：`{name}_start`

```
用户输入 /claude 帮我优化这段代码
        │
        ▼
command.execute.before 检测到命令（通过 frontmatter 的 delegate: claude）
        │
        ▼
模型调用 claude_start(prompt="帮我优化这段代码")
        │
        ▼
startDelegateTurn()
  ├─ 生成 sessionId（crypto.randomUUID）
  ├─ beginDelegateStart() 获取序列号
  ├─ snapshotWorktree() 记录当前 git 状态
  ├─ resolveArgs(startArgs, { prompt, sessionId })
  ├─ runDelegate() 启动 claude 子进程
  │   ├─ 解析 stdout 得到 finalText 与 externalId
  │   ├─ 外部 CLI 返回的 externalId 写入 session-store
  ├─ setActiveDelegateIfLatest() 原子注册会话
  ├─ buildChangeSummary() 生成本次变更摘要
  └─ 返回 finalText + 变更摘要
```

### 7.2 后续消息：`{name}_reply`

```
用户输入 再加一个测试
        │
        ▼
experimental.chat.system.transform 注入 sticky 路由规则
        │
        ▼
模型调用 claude_reply(prompt="再加一个测试")
        │
        ▼
replyDelegateTurn()
  ├─ 从 session-store 取出 active delegate 的 externalId
  ├─ resolveArgs(replyArgs, { prompt, externalId })
  ├─ runDelegate() 启动 claude --resume <externalId>
  ├─ 更新 session-store
  └─ 返回 finalText + 变更摘要
```

### 7.3 退出委派：`/opencode`

```
command.execute.before 拦截 /opencode
        │
        ▼
clearActiveDelegate(sessionID)
        │
        ▼
输出 [plugin] Cleared the active claude delegation for this session.
```

---

## 8. 安全设计

### 8.1 会话 ID 安全

外部 CLI 返回的 session ID 必须通过 `isValidExternalId()` 校验：

```ts
const EXTERNAL_ID_RE = /^[A-Za-z0-9_-]{8,128}$/
```

- 只接受字母、数字、下划线、连字符。
- 长度限制 8–128。
- 不符合时回退到客户端生成的 `crypto.randomUUID()`，避免把恶意字符串注入后续命令参数。

### 8.2 Argv 注入防护

`validateArgvInjection()` 确保：

1. `{prompt}` 前面必须有字面量 `--`。
   - 原因：用户消息是自由文本，可能以 `-` 开头；`--` 后的参数不会被解析为 flag。
2. `{externalId}` 必须是独立参数，且要么在 `--` 之后，要么紧跟一个以 `-` 开头的 flag 作为其值。
   - 原因：防止外部返回的 id 被解析成新的 flag。

### 8.3 Prompt 模板误转发检测

`tool.execute.before` 检查 `{name}_start` / `{name}_reply` 的 `prompt` 参数：

- 如果包含 `GENERATED_MARKER`，说明模型把整个命令模板文件内容当成 prompt 传了，立即拒绝。
- 这是针对某些模型（如 MiniMax-M3）已知问题的硬拦截。

### 8.4 模型校验门控

`verifiedModels` 配置后：

- `command.execute.before` 在 slash 命令触发时，读取 `chat.message` 缓存的当前模型。
- 如果模型不在允许列表，直接返回错误提示，不启动委派。
- 未知模型（首次消息）**fail open**，避免误伤；从第二次消息开始有模型信息即可生效。
- `tool.execute.before` 对直接调用 `{name}_start` / `{name}_reply` 也走同一门控，防止绕过 slash 命令。

### 8.5 外部进程安全

`runDelegate()` 默认使用 `Bun.spawn`，支持：

- 总 stdout 上限 `10_000_000` 字符。
- 单条 stdout 上限 `1_000_000` 字符。
- stderr 上限 `2_000_000` 字符。
- 超时（默认 10 分钟，可配置）。
- 用户取消（AbortSignal）。
- 超时后先 SIGTERM，2 秒后 SIGKILL 杀进程树。
- POSIX 使用 `detached` + 进程组信号；Windows 使用 `taskkill /T`。
- 进程退出后继续 drain 管道最多 5 秒，防止孙进程持管道导致挂起。

---

## 9. 会话状态管理

### 9.1 内存状态

运行时状态存在内存 Map 中：

```ts
const sessions = new Map<string, DelegateSession>()        // 当前活跃委派
const sessionAgents = new Map<string, string>()            // 缓存当前 agent
const sessionModels = new Map<string, SessionModel>()      // 缓存当前模型
const startSequences = new Map<string, number>()           // 并发 start 序列号
```

### 9.2 持久化状态

OpenCode 会话可能跨进程重启，因此 `setActiveDelegate()` 会把状态写入临时文件：

```ts
join(tmpdir(), "cli-dispatch-opencode", "active-delegations.json")
```

- 文件内容按 session ID 索引，记录 `{ delegate, externalId, updatedAt }`。
- 24 小时（`STATE_FRESH_MS`）未更新的条目会被视为过期，返回 `lost` 提示。
- 首次 `getActiveDelegate()` 时从文件 hydrated，并标记已恢复。
- 写文件采用 `.tmp` + `rename` 保证原子性。

### 9.3 并发 Start 竞争

当用户快速触发多次 `start` 时，使用序列号保证“只有最新发起的 start 才能注册会话”：

```ts
beginDelegateStart()     // 返回递增序列号
setActiveDelegateIfLatest(seq)  // 仅当 seq 仍是最新时才写入
```

---

## 10. 输出解析

`parse-events.ts` 为四种 parser 提供统一的 `LineParser`：

| parser | 外部 CLI | 解析逻辑 |
|---|---|---|
| `claude` | Claude Code `--output-format stream-json` | 解析 `assistant` 进度、`result` 最终结果；从 `session_id` 字段提取 externalId |
| `codex` | OpenAI Codex `--json` | 解析 `thread.started` 取 `thread_id`；`item.completed` 取 `agent_message` 文本 |
| `opencode` | `opencode run --format json` | 每行都有 `sessionID`；`text` 事件作为进度和最终文本 |
| `raw` | 任意自定义 CLI | 把每行 stdout 都作为进度和最终文本拼接 |

`runDelegate()` 的 `stdout` 和 `stderr` 通过 `readLines()` 异步读取，并解析成：

- `progressText`：实时进度，通过 `onProgress` 回调上报给宿主。
- `finalText`：最终结果返回给模型。
- `externalId`：会话 ID，用于后续 resume。

---

## 11. 健康检查

`health-check.ts` 中的 `checkDelegate(name, cfg)`：

1. 在系统临时目录创建隔离目录。
2. 用 `startArgs` 启动外部 CLI，prompt 为：
   ```
   Create a file named healthcheck.txt containing the word ok, then stop.
   ```
3. 等待 CLI 退出。
4. 检查隔离目录是否有文件生成。
   - 有文件 → `OK`，说明该 delegate 在当前权限/沙箱配置下可写。
   - 无文件 → `FAIL`，提示配置中的权限 flag 可能是 read-only。
5. 清理隔离目录。

这个检查不触碰工作区，仅验证 delegate 权限配置是否正确。

---

## 12. 测试策略

项目使用 `bun:test`，测试文件位于 `src/__tests__/`。截至 `1.0.2` 共有 245 个测试，覆盖：

| 测试文件 | 覆盖内容 |
|---|---|
| `config.test.ts` | 配置加载、查找链、验证、参数解析、默认配置 |
| `commands.test.ts` | 命令生成、idempotency、cc 别名、hand-maintained 文件保护、清理 |
| `delegate-tools.test.ts` | start/reply 工具注册、会话恢复、并发竞争、进度摘要 |
| `delegate-turn.test.ts` | 单次委派协调、externalId 回退、失败恢复 |
| `run-delegate.test.ts` | 子进程输出解析、超时、取消、输出上限、进程树杀 |
| `health-check.test.ts` | 可写性探针 |
| `hooks.test.ts` | `/opencode` 退出、verified-models 门控、prompt 清洗、命令拦截 |
| `parse-events.test.ts` | 四种 parser 的鲁棒性（非法 JSON、null、数组、缺失字段） |
| `policy.test.ts` | GENERATED_MARKER、externalId 校验、argv 注入防护 |
| `session-store.test.ts` | 内存状态、持久化、hydration、过期、并发 |
| `doctor-checks.test.ts` | 六项检查、异常不中断、绝对路径、jsonc patch |
| `doctor-cli.test.ts` | CLI 退出码、裸环境失败 |
| `doctor-tool.test.ts` | 插件内 doctor 工具覆盖六项 id |
| `claude-code-adapter-*.test.ts` | Claude Code 适配器 |

### 12.1 `dist/` 同步校验

CI 中运行：

```bash
bun run build
git diff --exit-code dist/
```

确保提交的 `dist/` 与 `src/` 完全一致。因为该包支持通过 git URL 直接安装，而 OpenCode 的 Bun 安装器不会自动执行 `prepare` 脚本，所以 `dist/` 必须随仓库提交。

---

## 13. CI / CD 与发布

### 13.1 `.github/workflows/ci.yml`

触发条件：所有 PR 和 `master`/`main` push。

步骤：

1. `actions/checkout@v4`
2. `oven-sh/setup-bun@v2`
3. `bun install`
4. `bun test`
5. `bun run build`
6. `git diff --exit-code dist/`

### 13.2 `.github/workflows/publish.yml`

触发条件：push `v*` tag。

步骤：

1. `actions/checkout@v4`
2. `oven-sh/setup-bun@v2`
3. `actions/setup-node@v4`（registry 指向 npmjs.org）
4. `bun install`
5. `bun test`
6. `bun run build`
7. `npm publish --provenance --access public`
8. `softprops/action-gh-release@v2` 自动生成 GitHub Release

权限：

```yaml
permissions:
  id-token: write   # npm provenance 需要
  contents: write   # 创建 GitHub Release 需要
```

### 13.3 发布流程

```bash
# 修改代码并合并到 master
npm version patch   # 或手动改 package.json
git commit
git push origin master

# 打 tag 自动触发发布
git tag v1.0.3
git push origin v1.0.3
```

`v1.0.2` 已按此流程发布：

- npm: https://www.npmjs.com/package/opencode-cli-dispatch
- GitHub Release: https://github.com/TurboSnails/OpenCodePlugin/releases/tag/v1.0.2

---

## 14. 安装与使用

### 14.1 全局安装（推荐）

```bash
bun add -g opencode-cli-dispatch
# 或 npm install -g opencode-cli-dispatch
```

在 `~/.config/opencode/opencode.json` 注册：

```json
{ "plugin": ["opencode-cli-dispatch"] }
```

插件加载时会自动把 `/cc`、`/claude`、`/codex`、`/opencode` 写入 `~/.config/opencode/commands/`。

### 14.2 项目级安装

```bash
bun add opencode-cli-dispatch
```

在 `.opencode/plugin/cli-dispatch.ts` 写 wrapper：

```ts
import { createCliDispatchPlugin } from "opencode-cli-dispatch"
export default createCliDispatchPlugin()
```

### 14.3 诊断

```bash
npx opencode-cli-dispatch doctor
npx opencode-cli-dispatch doctor --fix
```

---

## 15. 扩展指南

### 15.1 添加新的 CLI 代理

在 `cli-dispatch.config.json` 新增 delegate：

```json
{
  "delegates": {
    "gemini": {
      "binary": "gemini",
      "parser": "raw",
      "startArgs": ["--", "{prompt}"],
      "replyArgs": ["--", "{prompt}"]
    }
  }
}
```

插件会自动生成 `/gemini` 命令和 `gemini_start` / `gemini_reply` / `gemini_check` 工具。

### 15.2 添加新的 parser

1. 在 `src/config.ts` 的 `ParserName` 联合类型中加入新名称。
2. 在 `src/parse-events.ts` 中实现 `parseXxxLine`，注册到 `PARSERS`。
3. 更新 `src/config.ts` 的 parser 验证白名单。

### 15.3 自定义 commandsDir

```ts
// .opencode/plugin/cli-dispatch.ts
import { createCliDispatchPlugin } from "opencode-cli-dispatch"
export default createCliDispatchPlugin(undefined, { commandsDir: ".opencode/command" })
```

此时插件会把生成的命令文件写入项目目录，而不是全局目录。

---

## 16. 已知限制

- **Sticky 路由依赖模型自觉性**：`experimental.chat.system.transform` 把路由规则注入 system prompt，但 OpenCode 没有 hook 能强制模型一定调用 `{name}_reply`。如果某模型直接回答，路由会失效。`verifiedModels` 门控用于阻止已知有问题的模型。
- **doctor 的 `--fix` 不处理 `.jsonc` 注释**：修改 `.jsonc` 时会先剥除注释，再 `JSON.stringify` 写回，会丢失原有注释。
- **Windows 可执行检查**：`which()` 在 Windows 使用 `F_OK` 检查存在性，而不是 `X_OK`；已在测试和代码中覆盖 `.exe/.cmd/.bat` 扩展名。
- **doctor 的 slash-commands 检查只看全局 commands 目录**：如果用户显式设置了 `commandsDir` 为项目本地目录，doctor 仍会检查全局目录，需要手工维护本地命令文件。

---

## 17. Codex 宿主适配器

Codex 也可以作为宿主，把对话委派给 `claude`、`codex` 或任何已配置的 CLI 代理，契约与 OpenCode/Claude Code 宿主一致（sticky 路由、verified models 门控、prompt 模板清洗），但实现基元换成 Codex 自己的：MCP server + hooks + 自定义 prompts。

### 17.1 架构总览

| 组件 | 文件 | 作用 |
|---|---|---|
| MCP server | `src/codex-adapter/mcp-server.ts` | stdio MCP 服务器，按配置注册每个 delegate 的 `{name}_start` / `{name}_reply` 工具，外加 `cli_dispatch_status` |
| Hook 分发器 | `src/codex-adapter/hooks.ts` | 短生命周期进程：从 stdin 读 hook 事件 JSON，按 `hook_event_name` 分发到三个 handler |
| Hook handlers | `src/codex-adapter/hooks/{user-prompt-submit,pre-tool-use,session-end}.ts` | 退出命令、sticky 路由注入、模板误转发拦截、verified models 门控、会话结束清理 |
| Prompt 生成 | `src/codex-adapter/prompts.ts` | 向 `~/.codex/prompts/` 生成 `/{name}.md`（委派）和 `opencode.md`（退出），Codex 中以 `/prompts:<name>` 调用 |
| 配置 | `src/codex-adapter/config.ts` | 适配器配置加载与验证 |
| 状态存储 | `src/codex-adapter/session-store.ts` | 文件态委派状态 + `current-session` 文件 |
| Setup CLI | `src/codex-adapter/setup.ts` + `cli.ts` | `cli-dispatch codex <setup\|uninstall\|doctor> [--dry-run]` |

### 17.2 配置

查找链（`getCodexConfigSearchPaths`）：

1. `codex-adapter.config.json`（cwd）
2. `.codex/cli-dispatch.config.json`（cwd）
3. `~/.codex/cli-dispatch.config.json`
4. 都没有时回退到主配置 `cli-dispatch.config.json` 的 `delegates`

`delegates` 条目形状与 OpenCode 主配置完全一致（复用 `validateDelegates`）。差异点：

- `verifiedModels` 是裸模型字符串模式（`"gpt-5.6-sol"`、`"gpt-*"`、`"*"`），因为 Codex hook 不暴露 provider 维度；尾 `*` 通配、大小写敏感。
- delegate 名 `opencode` 被保留（它是退出 prompt 的名字），配置中出现即报错。

### 17.3 会话 ID 发现（D-store 设计）

Codex 的 MCP server 进程拿不到当前 session id，而 hook 每次调用都是独立进程。解决方案：`UserPromptSubmit` hook 每次把 `session_id` 写入 `~/.codex/cli-dispatch/current-session`（写临时文件再 rename，原子替换），MCP server 调工具时读这个文件确定当前会话。委派状态本身按 session 一个 JSON 小文件存放在同目录（0700），复用 Claude Code 适配器的 `fileDelegateStore`。

### 17.4 Hook 语义

- **`UserPromptSubmit`**：写 `current-session`；若 prompt 是 `/opencode`（或 `/prompts:opencode`）则确定性清除该会话的活动委派；若 prompt 含 `GENERATED_MARKER`（整个命令模板被误当作用户消息）则 `block`；若存在活动委派，则通过 `additionalContext` 注入路由指令（调用 `{delegate}_reply`，不要直接回答）。
- **`PreToolUse`**（matcher `mcp__cli_dispatch__.*`，只拦本适配器的 MCP 工具）：prompt 参数含 `GENERATED_MARKER` 则 `deny`（模板误转发防护）；配置了 `verifiedModels` 且当前模型不匹配时 `deny`，策略与 OpenCode 一致（模型未知时 fail-open）。
- **`SessionEnd`**：清除该会话的活动委派状态。

### 17.5 Setup / Uninstall / Doctor

`cli-dispatch codex setup` 做四件事（全部幂等，`--dry-run` 只打印不写盘）：

1. 确保状态目录 `~/.codex/cli-dispatch/` 存在（0700）。
2. 生成 prompts 到 `~/.codex/prompts/`（带 `GENERATED_MARKER`，清理时只删带标记的文件，不碰手写 prompt）。
3. 在 `~/.codex/config.toml` 中 upsert `[mcp_servers.cli_dispatch]` 段（按段头定位，保留其他内容）。
4. 在 `~/.codex/hooks.json` 注册三个 hook 事件（`UserPromptSubmit`、`PreToolUse`、`SessionEnd`），按 command 字符串去重。

`uninstall` 反向移除上述生成物；`doctor` 检查 MCP 注册、hook 注册、退出 prompt 是否存在，输出修复建议。setup 后需在 Codex 里运行 `/hooks` 信任新 hook 并重启 Codex。

---

## 18. 关键设计决策

| 决策 | 原因 |
|---|---|
| `dist/` 提交到仓库 | OpenCode 通过 git URL 安装插件时不会执行构建脚本，必须预编译。 |
| 默认写入全局 commands 目录 | npm 全局安装后，项目无需任何配置即可开箱使用。 |
| `GENERATED_MARKER` 保护手工文件 | 用户可能自定义 `/cc` 等命令，插件不应覆盖。 |
| 外部 CLI 返回的 externalId 严格校验 | 防止恶意 session id 注入后续命令参数。 |
| argv 注入防护 | 用户消息是自由文本， `--` 隔离和独立参数规则是安全底线。 |
| 并发 start 用序列号竞争 | 保证最新发起的委派胜出，避免旧进程覆盖新会话。 |
| 文件持久化 + 24h TTL | OpenCode 进程可能重启，需要恢复状态；TTL 防止使用过期的 externalId。 |
| doctor 设计成插件外 CLI 优先 | 当插件本身没加载成功时，插件内工具不可用，外部 CLI 必须能独立运行。 |
| Codex 会话 id 经 `current-session` 文件传递 | Codex 的 MCP server 进程拿不到 session id，由 hook 写文件、server 读文件解耦（D-store）。 |
| Codex delegate 名保留 `opencode` | 退出 prompt 固定叫 `opencode.md`，同名 delegate 会让 `/prompts:opencode` 语义冲突。 |

---

## 19. 相关文档

- `README.md`：快速上手指南
- `docs/installation.md`：安装方式（npm / tarball / git / 本地插件）
- `docs/configuration.md`：配置参考、权限说明、已知限制
- `docs/claude-code-adapter.md`：Claude Code 宿主适配器说明
- `docs/superpowers/specs/2026-07-22-onboarding-sprint-design.md`：Onboarding Sprint 设计 spec
- `docs/superpowers/plans/2026-07-22-onboarding-sprint.md`：Onboarding Sprint 实现计划

---

*本文档随 `v1.0.2` 编写，后续版本如有架构变更应同步更新。*
