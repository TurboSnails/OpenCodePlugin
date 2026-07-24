# opencode-cli-dispatch

[English](README.md)

一个 [OpenCode](https://opencode.ai) 插件，用于把当前对话委托（delegate）给外部 CLI coding agent（Claude Code、Codex，或任何你自行配置的 CLI agent），并把它的响应实时流回 OpenCode 聊天界面。委托是**尽力而为的粘性（best-effort sticky）**路由：一旦开始委托，该会话后续的消息会持续路由给同一个 delegate，直到你显式退出——但这依赖模型主动调用 delegate 的 reply 工具，没有任何 hook 能强制这一点（见[已知限制](docs/configuration.md#known-limitations)）。显式的 `/<delegate> <message>` 命令始终是触达 delegate 的可靠方式。

## 快速上手

完整快速上手步骤见 [README.md Quickstart](README.md#quickstart)。卡住了？运行 `npx opencode-cli-dispatch doctor`（或 `cli-dispatch doctor --fix`）自检。

详细文档均为英文：[Installation](docs/installation.md) · [Configuration](docs/configuration.md) · [Claude Code adapter](docs/claude-code-adapter.md)

## 特性

- **多 delegate 并存**：可以同时配置任意数量的 CLI agent（内置 `claude` 和 `codex` 两套预设）。
- **尽力而为的粘性路由**：执行 `/cc` 或 `/codex` 后，该会话之后的输入——包括纯文本消息和其他 slash 命令——都会被转发给当前激活的 delegate，直到执行 `/opencode` 为止。这依赖模型配合；如果模型直接作答而不调用工具，则超出插件的控制范围。
- **会话续接**：每个 delegate 都维护自己的外部会话 id，follow-up 消息会续接底层 CLI 的会话（`--resume` / `exec resume`），而不是每次重新开一个新会话。
- **自动生成命令**：为每个配置的 delegate 自动生成对应的 `/{name}` 委托命令，以及一个共用的 `/opencode` 退出命令。
- **变更摘要**：每一轮 delegate 调用前后都会对 git 工作区做一次快照对比，并在响应末尾附上简要摘要（`git diff --stat` + 新增的未跟踪文件）。
- **健康检查**：`{name}_check` 工具会在一个隔离的临时目录中启动该 delegate，验证它在当前配置的权限参数下确实可以写文件，且不会影响你的工作区。
- **受限 agent 防护**：当前激活的 OpenCode agent（例如 `plan`）如果通过系统提示词禁止了工具调用，插件会主动提示而不是让 delegate 静默失败或行为异常。

## 工作原理

每个已配置的 delegate（如 `claude`、`codex`）在插件加载时都会生成三个工具：

| 工具 | 作用 |
|---|---|
| `{name}_start` | 用给定 prompt 启动一个新的 CLI 会话，拉起对应二进制，并记录外部会话 id。 |
| `{name}_reply` | 用新的 prompt 续接该会话当前激活的 delegate 会话。 |
| `{name}_check` | 在隔离的临时目录中启动 delegate，确认其在当前权限/沙箱配置下可以正常写文件。 |

以下几个 hook 把这些能力接入了 OpenCode 的聊天流程：

- `experimental.chat.system.transform`：在有活跃委托时，向系统提示词中注入一条路由规则，让模型调用 `{name}_reply` 而不是自己直接作答。
- `chat.message`：按会话记录当前使用的 OpenCode agent（供受限 agent 防护使用），并清理注入的 `@mention` 样板文本。
- `command.execute.before`：拦截 `/opencode` 命令，确定性地清除该会话当前激活的委托状态。

当前激活的 delegate 状态（哪个 delegate、对应的外部会话 id、当前 OpenCode agent）保存在内存中的一个会话状态存储里，以 OpenCode 会话 id 为 key。

## 安装、配置与 Claude Code 适配器

- 安装与打包：详见 [docs/installation.md](docs/installation.md)（英文）。
- 配置、权限与已知限制：详见 [docs/configuration.md](docs/configuration.md)（英文）。
- Claude Code 适配器：详见 [docs/claude-code-adapter.md](docs/claude-code-adapter.md)（英文）。

## 开发

```bash
bun install
bun run build   # tsc -> dist/
bun run dev      # tsc --watch
bun test         # bun test，测试文件见 src/__tests__
```

源码结构：

| 文件 | 职责 |
|---|---|
| [src/index.ts](src/index.ts) | 插件入口，负责把配置、工具、hook 组装在一起。 |
| [src/config.ts](src/config.ts) | 配置加载/校验，以及 `{占位符}` 参数模板解析。 |
| [src/delegate-tools.ts](src/delegate-tools.ts) | `{name}_start` / `{name}_reply` 工具实现，以及基于 git diff 的变更摘要。 |
| [src/health-check.ts](src/health-check.ts) | `{name}_check` 工具——隔离环境下的可写性探测。 |
| [src/hooks.ts](src/hooks.ts) | 系统提示词路由注入、agent 跟踪、`/opencode` 退出处理。 |
| [src/commands.ts](src/commands.ts) | 生成 `/{name}` 和 `/opencode` 的 markdown 命令文件。 |
| [src/routing-rule.ts](src/routing-rule.ts) | 构建注入到系统提示词中的粘性路由指令。 |
| [src/run-delegate.ts](src/run-delegate.ts) | 启动 delegate 二进制并把 stdout 流式传给解析器。 |
| [src/parse-events.ts](src/parse-events.ts) | 各 CLI 的 stdout 事件解析器（`claude`、`codex`、`opencode`、`raw`）。 |
| [src/session-store.ts](src/session-store.ts) | 按 OpenCode 会话 id 存储的内存态 delegate/agent 状态。 |
| [src/claude-code-adapter/](src/claude-code-adapter/) | Claude Code 宿主适配器：MCP server、`PreToolUse`/`UserPromptSubmit` hooks、文件持久化的会话状态。 |

## 许可证

MIT
