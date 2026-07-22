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

`dist/` 目录已经提交进本仓库（没有被 gitignore），目的就是让这个包可以直接从 git 地址安装（见下方[方式三](#方式三一次性全局安装所有项目通用)），不需要在安装时再跑一次构建——因为 OpenCode 的 npm/git 插件安装器（底层用 Bun）默认**不会**执行 `prepare`/`postinstall` 之类的生命周期脚本。**以后改动 `src/` 下的代码时，请在同一次改动里重新构建并一并提交 `dist/`**，否则通过 git 安装的用户会一直用到旧的编译产物。

这个仓库目前还没有发布到任何 npm registry，如果想在不走 git 的情况下安装到别处，可以先在本地打出一个 tarball：

```bash
bun install          # 安装依赖
bun run build         # tsc -> dist/
npm pack              # 在仓库根目录生成 opencode-cli-dispatch-<version>.tgz
```

`npm pack` 会根据 `package.json` 里的 `files` 字段（`dist/`、`cli-dispatch.config.json`）以及 `README.md`/`package.json` 打包 tarball；如果只想预览打包内容而不实际生成文件，先跑一遍 `npm pack --dry-run` 即可。

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

### 方式三：一次性全局安装（所有项目通用）

上面两种方式都是按项目装的。OpenCode 还有一个全局配置目录 `~/.config/opencode/`，对你打开的所有项目都生效——如果不想每个仓库都重复配置一遍，装这里就够了。以下内容已对照 [OpenCode 官方 plugin 文档](https://opencode.ai/docs/plugins/) 和 [commands 文档](https://opencode.ai/docs/commands/) 核实，并且在一台真实机器上和 `~/.config/opencode/opencode.jsonc`、`~/.config/opencode/plugins/` 的实际内容做了交叉验证——这两个目录目前正在被实际使用（例如 `superpowers` 插件就是用同样的方式加载的）。

**1. 在全局配置里注册插件**，写进 `~/.config/opencode/opencode.json` 或 `opencode.jsonc`：

```json
{
  "plugin": ["opencode-cli-dispatch@github:TurboSnails/OpenCodePlugin"]
}
```

OpenCode 会在启动时用 Bun 自动安装 npm/git 形式的插件依赖，缓存在 `~/.cache/opencode/` 下。因为 `dist/` 已经提交进本仓库（见[打包](#打包)一节），单纯的 git checkout 就够用了——安装过程中不会、也不需要再跑一次构建。

如果以后发布到 npm 了，这一步可以简化成 `"plugin": ["opencode-cli-dispatch"]`。

**2. slash 命令也需要装到全局。** OpenCode 会从 `~/.config/opencode/commands/` 读取 markdown 命令文件，对所有项目生效（[文档](https://opencode.ai/docs/commands/)）。把本仓库的 `.opencode/command/cc.md`、`codex.md`、`opencode.md` 复制过去：

```bash
mkdir -p ~/.config/opencode/commands
cp .opencode/command/*.md ~/.config/opencode/commands/
```

（目前没有办法让通过 npm 安装的插件自动把 `createCliDispatchPlugin` 的 `commandsDir` 指向这个全局目录——它只会相对于调用时传入的路径生效。在这个能力补上之前，手动复制是最可靠的办法。）

**3. 全局安装仍然需要各项目自己的 delegate 配置文件。** `cli-dispatch.config.json` 的查找路径（见[配置](#配置)一节）是相对于 `process.cwd()`，也就是你当前所在的项目，而不是 `~/.config/opencode/`。如果某个项目下没有配置文件，插件会退回到内置的 `claude` + `codex` 默认配置，大多数情况下这样就够用了。如果你想让所有项目都用自定义的 delegate/参数，要么在每个项目里各放一份 `cli-dispatch.config.json`，要么改用方式二（本地插件文件）从一个薄封装文件里显式传入绝对路径的 `configPath`，而不是走纯全局 npm 安装这条路。

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
| `parser` | `"claude"`、`"codex"`、`"opencode"` 或 `"raw"` —— 决定如何把 stdout 事件解析成进度更新和最终响应。`"opencode"` 解析 `opencode run --format json` 的输出（session id 取自每行都有的 `sessionID` 字段，最终响应由 `text` 事件按序累积）。其中 `raw` 的最终响应是把所有 stdout 行按顺序用换行拼接（而不是只取最后一行）。 |
| `startArgs` | 首轮调用的参数模板，支持占位符 `{prompt}`、`{sessionId}`。 |
| `replyArgs` | 后续调用的参数模板，支持占位符 `{prompt}`、`{externalId}`（delegate 在启动时返回的会话 id）。 |
| `timeoutMs` | 可选。单次调用的超时时间（毫秒），覆盖默认的 10 分钟超时（见[超时与取消](#超时与取消)）。必须是正数，否则配置校验会失败。 |

新增一个 delegate 只需要在 `delegates` 下新增一个条目——对应的 `/{name}` 命令，以及 `{name}_start` / `{name}_reply` / `{name}_check` 三个工具都会自动生成。

### 已验证模型 verifiedModels

粘性委托和 prompt 转发依赖模型自己遵循通过系统提示词和命令文本注入的约定——OpenCode 没有任何机制能强制模型调用指定工具（见[已知限制](#已知限制)）。部分模型并不遵守这个约定；可选的顶层字段 `verifiedModels` 是一份白名单，配置后插件会拒绝为不在名单上的模型启动委托，而不是任由它默默出错：

```json
{
  "delegates": { "...": "..." },
  "verifiedModels": ["anthropic/*", "moonshotai/kimi-for-coding-k3"]
}
```

每一项是 `provider/model` 形式的字符串；任意一段都可以以 `*` 结尾做通配（`anthropic/*` 匹配所有 Anthropic 模型；`*/k3` 匹配任意 provider 下的 `k3`）。匹配区分大小写，除尾部通配符外不支持其他 glob 语法。

- **不配置或配置为空数组**：不做任何限制——所有模型都可以启动委托。这是默认行为,已有配置无需改动。
- **配置且非空**：当用户执行某个 delegate-start 命令(如 `/claude`、`/cc`)且该会话当前模型不匹配任何一项时,插件会在 `{name}_start` 被调用之前就拦截该命令,返回一条说明当前模型的消息。
- **模型未知的情况**：OpenCode 只在 `chat.message` 时报告当前模型,而这个 hook 在会话的第一条消息上是晚于 `command.execute.before` 触发的——所以会话的第一条 delegate-start 命令执行时,插件还不知道当前模型是什么。这种情况下按"放行"处理(fail open),而不是让每个全新会话的第一条命令都被拦下;从该会话的第二条 delegate-start 命令起,白名单才会真正生效。

这套机制无法、也不能保证模型在每一次粘性 follow-up 时都调用 `{name}_reply`——如果模型选择直接输出文字、完全不调用任何工具,没有任何 hook 会被触发。它能做到的是"已知有问题的模型被挡在门外",而不是"强制所有模型都乖乖配合"。

另有一个始终生效、与 `verifiedModels` 是否配置无关的检查:如果 `{name}_start`/`{name}_reply` 的 `prompt` 参数里包含了整段委托命令模板(通过内部标记识别),而不是用户的真实消息,调用会被拒绝。

### 配置错误与 `cli_dispatch_status` 工具

出现以下情况时配置校验会失败：delegate 名称不匹配 `/^[\w-]+$/`（只允许字母、数字、下划线、连字符，否则生成的工具名非法）、`binary`/`parser` 缺失或非法、`startArgs` 不是字符串数组或缺少 `{prompt}` 占位符（没有它 CLI 会在没有任何任务内容的情况下运行）、`timeoutMs` 不是正数。而 `replyArgs` 缺少 `{externalId}` 只会打印一条警告——对没有会话概念的 raw delegate 来说，没有可续接的会话是合理的。

配置加载失败时，插件不再静默失效：它会注册一个 `cli_dispatch_status` 诊断工具，而不是什么都不注册。调用它可以看到配置文件路径、所有校验错误以及修复方法——改好配置后重启 OpenCode 即可重新加载插件。

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

插件会按配置为每个 delegate 生成一个 slash 命令，命名为 `/<delegate-name>`（如 `/claude`、`/codex`）。本仓库中的 `/cc` 是 [.opencode/command/cc.md](.opencode/command/cc.md) 里手工维护的 `/claude` 别名，并非插件生成。

- `/<delegate-name> <消息>` —— 启动（或继续）一个到该 delegate 的委托（如 `/claude <消息>`、`/codex <消息>`，或 `/cc` 别名）。
- `/opencode` —— 退出该会话当前激活的委托，之后由 OpenCode 自己直接作答。

在委托激活期间，该会话中**之后所有**的输入——普通消息、其他 slash 命令、`@agent` 提及——都会作为 prompt 文本转发给当前的 delegate，直到执行 `/opencode` 为止。如果某次 delegate 调用失败，错误信息会直接返回到对话中，并提示运行 `/opencode`；委托状态本身不会被自动清除，方便你重试或先排查问题。

### 超时与取消

每次 delegate 调用默认有 10 分钟的超时上限，可以在配置里用 `timeoutMs` 按 delegate 单独覆盖。在 OpenCode 中取消工具调用（按 Esc）会立即终止 delegate 子进程，并报 `cancelled by user`，与超时或崩溃可以区分开。终止时先发 SIGTERM，宽限 2 秒后再升级为 SIGKILL。

delegate 子进程在会话的项目目录（OpenCode 在工具上下文中提供的 `directory`）下运行，变更摘要也基于该目录计算；拿不到该目录时回退为插件进程的 cwd。

### 已知限制

部分模型无法可靠地遵循注入的粘性路由系统提示词。经过验证（2026-07-19）：MiniMax-M3（`minimax-cn` / `minimaxi-cn`，某些环境下 `opencode serve` 的默认模型）会把展开后的整个命令模板当作 prompt 转发给 `{name}_start`（而不是只转发 `/cc`、`/codex` 后面的用户输入），导致 delegate 把它当作疑似 prompt injection 而拒绝执行；并且在纯文本 follow-up 时会忽略粘性路由规则，直接自己作答而不是调用 `{name}_reply`——即便路由规则是中英双语且重复注入的情况下依然如此。Kimi（`kimi-for-coding/k3`）已验证可以正常配合本插件工作。

现在这个问题不再只是"记录在文档里"，而是有了实际缓解手段：配置 [`verifiedModels`](#已验证模型-verifiedmodels) 可以让插件拒绝为不在白名单上的模型启动委托；而 prompt 参数被整段命令模板污染的情况，插件始终会拒绝，与配置无关（见[已验证模型](#已验证模型-verifiedmodels)）。但这两个机制都无法强制一个选择直接输出文字、完全不调用任何工具的模型去调用 `{name}_reply`——这种情况下没有任何 OpenCode hook 会被触发——所以粘性委托里"续接"这部分，仍然要求模型本身有基本的指令遵从能力。

同一会话内如果并发发起多个 `{name}_start`，以最新发起的为准：先发起但后完成的调用不会覆盖更新的委托。

## Claude Code 适配器

Claude Code 也可以作为宿主，把会话委派给 `codex` 和 `opencode`，契约与 OpenCode 插件相同（粘性路由 / verifiedModels 门槛 / prompt 模板消毒），但实现在 Claude Code 的扩展机制上：MCP server 注册 delegate 工具，`PreToolUse` / `UserPromptSubmit` hooks（在 `.claude/settings.json` 里配置的短命 shell 进程）负责模板消毒、粘性路由规则注入、模型门槛和 `/cc` 退出命令。本仓库自用该适配器，以下文件就是它的实际安装形态：

1. `.mcp.json` 注册 `cli-dispatch` MCP server（`bun run src/claude-code-adapter/mcp-server.ts`）。Claude Code 第一次见到项目级 `.mcp.json` 时会要求**一次性交互批准**——必须批准，否则 delegate 工具不会出现。hooks 在设计上不依赖 MCP server 在线：即使还没批准，`/cc` 退出和 verifiedModels 拦截也照常工作。
2. `.claude/settings.json` 注册两个 hooks。
3. `.claude/commands/` 提供 `/codex`、`/opencode`（委派出去）和 `/cc`（回家——与 OpenCode 的 `/opencode` 同为"说出宿主自己的名字"约定）。

配置放在项目根目录的 `claude-code-adapter.config.json`（文件缺失时回退到内置的 codex+opencode 默认配置）。`delegates` 条目与上文 OpenCode 的[配置](#配置)完全同构。适配器的 `verifiedModels` 形状与 OpenCode 版的 `provider/model` 对不同：Claude Code 没有 provider 维度，所以条目是裸模型串 pattern（`"claude-sonnet-5"`、`"claude-*"`、`"*"`）——支持结尾 `*` 通配、大小写敏感，模型未知时同样放行（fail open），见[已验证模型 verifiedModels](#已验证模型-verifiedmodels)。

委派状态（当前 delegate、外部 session id）以每个 Claude Code session 一个小 JSON 文件的形式持久化在系统临时目录（`cli-dispatch-claude-code/`），因为每次 hook 调用都是独立进程；当前模型不做持久化——每次检查时从会话 transcript 里现读。

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
| [src/claude-code-adapter/](src/claude-code-adapter) | Claude Code 宿主适配器：MCP server、`PreToolUse`/`UserPromptSubmit` hooks、文件持久化的会话状态。 |

## 许可证

MIT
