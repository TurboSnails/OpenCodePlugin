# opencode-cli-dispatch

[English](README.md)

一个 [OpenCode](https://opencode.ai) 插件，用于把当前对话委托（delegate）给外部 CLI coding agent（Claude Code、Codex，或任何你自行配置的 CLI agent），并把它的响应实时流回 OpenCode 聊天界面。委托是**粘性（sticky）**的：一旦开始委托，该会话后续的所有消息都会持续发给同一个 delegate，直到你显式退出。

## 特性

- **多 delegate 并存**：可以同时配置任意数量的 CLI agent（内置 `claude` 和 `codex` 两套预设）。
- **粘性路由**：执行 `/cc` 或 `/codex` 后，该会话之后的所有输入——包括纯文本消息和其他 slash 命令——都会被转发给当前激活的 delegate，直到执行 `/opencode` 为止。
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

## 打包

这个仓库目前还没有发布到任何 npm registry，所以先在本地打出一个 tarball 供其他项目安装：

```bash
bun install          # 安装依赖
bun run build         # tsc -> dist/
npm pack              # 在仓库根目录生成 opencode-cli-dispatch-<version>.tgz
```

`npm pack` 会根据 `package.json` 里的 `files` 字段（`dist/`、`commands/`、`cli-dispatch.config.json`）以及 `README.md`/`package.json` 打包 tarball；如果只想预览打包内容而不实际生成文件，先跑一遍 `npm pack --dry-run` 即可。

## 安装方式

本项目设计为被其他 OpenCode 项目引用，可以通过 npm 依赖（用上面打出的 tarball，或将来发布到 registry 后的正式版本）或本地插件文件两种方式接入。

### 方式一：把 tarball 装到另一个项目里

在**目标项目**（不是本仓库）目录下执行：

```bash
npm install /path/to/mcpOC/opencode-cli-dispatch-1.0.0.tgz
# 或者用 file: 依赖方式，避免直接把 tarball 拷进 node_modules：
npm install "file:/path/to/mcpOC/opencode-cli-dispatch-1.0.0.tgz"
```

（如果以后发布到 npm 了，这一步就可以简化成 `npm install opencode-cli-dispatch` / `bun add opencode-cli-dispatch`。）

然后在该项目的 `opencode.json` / `opencode.jsonc` 中注册：

```json
{
  "plugin": ["opencode-cli-dispatch"]
}
```

**注意——slash 命令不会自动打包进去。** `/cc`、`/codex`、`/opencode` 这几个命令文件位于本仓库的 [.opencode/command/](.opencode/command) 下，是手动维护并提交的，**并不包含**在 npm tarball 里；`createCliDispatchPlugin()` 只有在传入 `options.commandsDir` 时才会（重新）生成它们。所以以 npm 依赖方式安装后，需要二选一：

1. 在目标项目里让 `commandsDir` 指向自己的命令目录，插件每次加载时自动生成：
   ```ts
   // other-project/.opencode/plugin/cli-dispatch.ts
   import { createCliDispatchPlugin } from "opencode-cli-dispatch"
   export default createCliDispatchPlugin(undefined, { commandsDir: ".opencode/command" })
   ```
2. 或者手动把本仓库 `.opencode/command/cc.md`、`codex.md`、`opencode.md` 三个文件复制到目标项目的 `.opencode/command/` 下。

### 方式二：本地插件文件（不安装包）

OpenCode 会自动加载项目根目录 `.opencode/plugin/` 下的任意 `.ts`/`.js` 文件。你可以放一个薄封装文件进去（本仓库自身就是这样自举的，见 [.opencode/plugin/cli-dispatch.ts](.opencode/plugin/cli-dispatch.ts)），直接从本仓库的源码或 `dist/` 引入，完全不需要安装包：

```ts
// .opencode/plugin/cli-dispatch.ts
import { createCliDispatchPlugin } from "opencode-cli-dispatch"

export default createCliDispatchPlugin()
```

`createCliDispatchPlugin(configPath?, options?)` 支持两个可选参数：

- `configPath` — 覆盖 delegate 配置的读取路径（见下文）。
- `options.commandsDir` — 如果设置，每次插件加载时都会把 `/{name}` 和 `/opencode` 这些 slash 命令文件重新生成到该目录（默认使用已提交在 `.opencode/command/` 下的文件）。

## 配置

delegate 的行为由 `cli-dispatch.config.json` 定义，按以下顺序解析（命中第一个即用）：

1. 传给 `createCliDispatchPlugin` 的 `configPath`（如果有）
2. `./cli-dispatch.config.json`
3. `./.opencode/cli-dispatch.config.json`
4. `./.opencode/lib/cli-dispatch/config.json`
5. 以上都不存在时，使用内置默认配置（即下方展示的 `claude` + `codex` 预设）

```json
{
  "delegates": {
    "claude": {
      "binary": "claude",
      "parser": "claude",
      "startArgs": [
        "-p", "--output-format", "stream-json", "--verbose",
        "--permission-mode", "bypassPermissions",
        "--session-id", "{sessionId}",
        "--", "{prompt}"
      ],
      "replyArgs": [
        "-p", "--output-format", "stream-json", "--verbose",
        "--permission-mode", "bypassPermissions",
        "--resume", "{externalId}",
        "--", "{prompt}"
      ]
    },
    "codex": {
      "binary": "codex",
      "parser": "codex",
      "startArgs": ["exec", "--json", "-c", "sandbox_mode=workspace-write", "--skip-git-repo-check", "--", "{prompt}"],
      "replyArgs": ["exec", "resume", "{externalId}", "--json", "-c", "sandbox_mode=workspace-write", "--skip-git-repo-check", "--", "{prompt}"]
    }
  }
}
```

每个 delegate 条目的字段说明：

| 字段 | 含义 |
|---|---|
| `binary` | 要启动的可执行文件（需在 `PATH` 中，或提供绝对路径）。 |
| `parser` | `"claude"`、`"codex"` 或 `"raw"` —— 决定如何把 stdout 事件解析成进度更新和最终响应。 |
| `startArgs` | 首轮调用的参数模板，支持占位符 `{prompt}`、`{sessionId}`。 |
| `replyArgs` | 后续调用的参数模板，支持占位符 `{prompt}`、`{externalId}`（delegate 在启动时返回的会话 id）。 |

新增一个 delegate 只需要在 `delegates` 下新增一个条目——对应的 `/{name}` 命令，以及 `{name}_start` / `{name}_reply` / `{name}_check` 三个工具都会自动生成。

### Delegate 权限

每个 delegate 都作为独立子进程运行，拥有自己的一套权限/沙箱系统，完全由 `startArgs`/`replyArgs` 中写死的参数控制。

**delegate 默认应当具备写权限。** 如果某个 delegate 无法编辑文件，先检查其参数配置，或运行 `{name}_check` 工具（如 `claude_check`）在隔离目录中验证其可写性。

#### claude

`--permission-mode <mode>`：

| 模式 | 效果 |
|---|---|
| `bypassPermissions` | 所有工具操作无需询问，直接允许（本包默认值） |
| `acceptEdits` | 文件编辑自动接受，其他操作仍需确认 |
| `dontAsk` | 需要权限的操作会**被直接拒绝而不询问**——相当于只读 |
| `plan` | 只读规划模式 |

#### codex

`-c sandbox_mode=<mode>`：

| 模式 | 效果 |
|---|---|
| `workspace-write` | 可以在工作区内写文件（本包默认值） |
| `read-only` | 任何地方都不能写 |

#### 权限在启动时就已固定

一个 delegate 会话在其整个生命周期内都保持启动时的参数不变（follow-up 会续接同一个底层会话）。**修改 `cli-dispatch.config.json` 后，请执行 `/opencode` 退出当前委托并重新开始**——已存在的 delegate 会话不会自动应用新的参数。

## 使用方法

- `/cc <消息>` —— 启动（或继续）一个 Claude Code 委托。
- `/codex <消息>` —— 启动（或继续）一个 Codex 委托。
- `/opencode` —— 退出该会话当前激活的委托，之后由 OpenCode 自己直接作答。

在委托激活期间，该会话中**之后所有**的输入——普通消息、其他 slash 命令、`@agent` 提及——都会作为 prompt 文本转发给当前的 delegate，直到执行 `/opencode` 为止。如果某次 delegate 调用失败，错误信息会直接返回到对话中，并提示运行 `/opencode`；委托状态本身不会被自动清除，方便你重试或先排查问题。

### 已知限制

部分模型无法可靠地遵循注入的粘性路由系统提示词。经过验证（2026-07-19）：MiniMax-M3（`minimax-cn` / `minimaxi-cn`，某些环境下 `opencode serve` 的默认模型）会把展开后的整个命令模板当作 prompt 转发给 `{name}_start`（而不是只转发 `/cc`、`/codex` 后面的用户输入），导致 delegate 把它当作疑似 prompt injection 而拒绝执行；并且在纯文本 follow-up 时会忽略粘性路由规则，直接自己作答而不是调用 `{name}_reply`——即便路由规则是中英双语且重复注入的情况下依然如此。Kimi（`kimi-for-coding/k3`）已验证可以正常配合本插件工作。

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
| [src/parse-events.ts](src/parse-events.ts) | 各 CLI 的 stdout 事件解析器（`claude`、`codex`、`raw`）。 |
| [src/session-store.ts](src/session-store.ts) | 按 OpenCode 会话 id 存储的内存态 delegate/agent 状态。 |

## 许可证

MIT
