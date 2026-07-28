# server-truth 诊断 + release/CI hygiene — 设计文档

日期：2026-07-27
状态：已获用户批准（brainstorming 阶段）

## 背景与问题

当前 reliability cleanup 已完成并发布到 `1.2.1`：doctor 9/9 绿、重复注册可检测、`CLI_DISPATCH_DEV=1` 测试已隔离。仍有两个薄弱点：

1. **doctor 看到的是自己进程的 env，不一定是 opencode server 进程的 env**。`duplicate-plugin-registration` 用 doctor 进程里的 `CLI_DISPATCH_DEV` 判断 dev-gated wrapper 是否 active；如果 server 启动时 env 不同，诊断可能不准。
2. **没有 CI 与 changelog**。`bun test`、`CLI_DISPATCH_DEV=1 bun test`、isolated HOME 测试都只能手动跑；`1.2.0` / `1.2.1` 只有 git log，没有 release notes。另发现 `docs/installation.md` 的 tarball 示例仍写 `1.0.3`。

## 目标

做两个方向：**server-truth 诊断** 与 **release/CI hygiene**。让 duplicate/env 诊断优先依据 opencode server 加载插件时留下的证据，并把核心测试矩阵纳入 CI。

非目标：不做 opencode 上游插件热重载；不在 CI 里跑需要真实 claude/codex 凭据的 doctor smoke；不改变 delegate spawn flags、verifiedModels、sticky routing。

## 设计

### 1. server-truth load manifest

- 新增 `src/load-manifest.ts`：提供 `writeLoadManifest(input)` 与 `readLoadManifest(ctx)`。插件每次加载时写 per-project manifest 到 `~/.local/share/opencode/cli-dispatch/loaded-<sha1(cwd).slice(0,12)>.json`；目录 mode `0700`，文件 mode `0600`，原子写（tmp + rename）。
- manifest 内容：`version`、`pid`、`cwd`、`loadedAt`（ISO）、`cliDispatchDev`（server 进程里的 `CLI_DISPATCH_DEV === "1"`）、`configPath`、`delegates`、`tools`、`commandsDir`。
- `src/index.ts` 在成功加载与 config 失败降级路径都调用 `writeLoadManifest`；manifest 写入失败只 `console.warn`，不影响插件加载。
- doctor 新增 `server-load-manifest` 检查：读取 manifest，验证 cwd 匹配、pid alive（`process.kill(pid, 0)`）、version 与当前 package 一致；缺失/stale 时报告但不让其他检查崩溃。
- `duplicate-plugin-registration` 优先使用 fresh manifest 的 `cliDispatchDev` 判断 dev-gated wrapper 是否真正 active；manifest 缺失/stale 时回退到现有文件/env heuristic，并在 detail 中说明判断来源（`server manifest` 或 `doctor process env`）。
- 测试覆盖：manifest 写入/读取、pid stale 回退、server env 与 doctor env 不一致时 duplicate check 以 server manifest 为准、manifest 写入失败不阻断插件加载。

### 2. release / CI hygiene

- 新增 `.github/workflows/ci.yml`：checkout → setup Bun → `bun install` → `bun run build` → `bun test` → `bun run test:dev` → `bun run test:isolated`。不跑真实 doctor smoke（需要 claude/codex 凭据，CI 脆弱）；doctor 行为由 `doctor-checks` / `doctor-cli` 测试覆盖。
- 新增 `CHANGELOG.md`，从 `1.2.1` 开始记录；后续 release commit 必须同步更新 changelog。
- 修 `docs/installation.md` 的 stale tarball 示例：`opencode-cli-dispatch-1.0.3.tgz` 改为 `opencode-cli-dispatch-<version>.tgz`。
- 版本策略：这两块合并后按 minor 升到 `1.3.0`（新增 server-truth 诊断能力；CI/docs 不单独 bump）。

## 错误处理

- manifest 写失败：warn only，不阻断插件加载。
- manifest 读失败/JSON 损坏/stale pid：doctor 报告并回退到现有 heuristic。
- CI 失败：不合并；`test:dev` 与 `test:isolated` 与默认 `bun test` 同为必需检查。

## 成功标准

- 当 opencode server 以 `CLI_DISPATCH_DEV=1` 启动而 doctor 进程未设置该 env（或相反）时，`duplicate-plugin-registration` 的结果以 fresh server manifest 为准。
- doctor 输出能明确说明 duplicate/env 判断来源是 `server manifest` 还是 `doctor process env`。
- CI 在干净 checkout 上跑通 build + 三种测试脚本。
- `CHANGELOG.md` 存在并记录 `1.2.1` 起点；`docs/installation.md` 不再引用 `1.0.3`。
