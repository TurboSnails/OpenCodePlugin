# A1 — Deep delegation gate — 设计文档

日期：2026-07-27
状态：已获用户批准（brainstorming 阶段）

## 背景与问题

同一条 delegation gate policy 当前被复制在多个 host seam 上：OpenCode `src/hooks.ts`、Claude adapter `pretooluse-check.ts` / `userpromptsubmit-logic.ts`、Codex adapter `hooks/pre-tool-use.ts`。它包含两半：

1. **verified-model allow-list**：model known 且不 match 时拒绝；model unknown 或无 patterns 时 fail open。
2. **GENERATED_MARKER prompt-template rejection**：delegate tool 的 `prompt` 参数包含整份 generated command template 时拒绝。

同时，wildcard matcher 也被复制三份：OpenCode `provider/model` 语法在 `src/config.ts`，Claude/Codex bare model 语法在各自 adapter config。reason 文案也分散，只有 prefix 不同（`[plugin]` vs `[cli-dispatch]`）。

## 目标

把这两半收进 `src/policy.ts`，让它成为 deep `delegation-gate` module：一个小 interface 输出 allow/deny(reason)，三个 host 只映射各自 verdict 形状。行为保持不变。

## 范围

做：
- 统一 verified-model gate 与 GENERATED_MARKER template rejection。
- 统一 `provider/model` 与 bare model 的 wildcard matcher 和 pattern validation primitives。
- host adapters 改为调用同一个 gate decision。

不做（留给后续）：
- config search/load pipeline（A2）。
- generated-file-sync（A3）。
- DoctorRun context（B4）。
- RESTRICTIVE_AGENTS / delegate-turn policy 下沉（B5）。
- session-context lifecycle（C6）。

## 设计

### 1. policy module interface

`src/policy.ts` 新增/收敛：

- `type ModelRef = string | { providerID: string; modelID: string }`
- `type GateTarget = { kind: "command" | "tool"; delegate: string; tool?: string }`
- `checkDelegationGate(input: { target: GateTarget; prompt?: unknown; model?: ModelRef; verifiedModels?: string[]; prefix: "[plugin]" | "[cli-dispatch]" }): { allow: true } | { allow: false; reason: string }`
- `matchesVerifiedModel(model: ModelRef, patterns: string[]): boolean`
- `isValidVerifiedModelPattern(entry: unknown, mode: "provider-model" | "bare"): entry is string`

matcher 规则：`provider/model` pattern 只匹配 object model 的 provider + modelID（两段都可 trailing `*`）；bare pattern 匹配 string model 或 object 的 `modelID`（trailing `*`）。这覆盖 OpenCode 的 `provider/model` 语法和 Claude/Codex adapter 的 bare 语法。

gate 顺序保持现状：非 delegate target → allow；prompt 含 `GENERATED_MARKER` → deny template reason；无 verifiedModels 或 model unknown → allow；model known 且不 match → deny model reason。reason 文案用 `prefix` 保持 `[plugin]` vs `[cli-dispatch]` 现状。

### 2. host adapters

- OpenCode：`src/hooks.ts` 的 `makeCommandBefore` 与 `makeToolExecuteBefore` 调用 `checkDelegationGate`；`src/config.ts` 的 verifiedModels matcher/entry validation 改为使用 policy primitives。
- Claude adapter：`pretooluse-check.ts` 与 `userpromptsubmit-logic.ts` 调用同一 gate；`claude-code-adapter/config.ts` 删除本地 matcher，改用 policy bare 模式 primitives。
- Codex adapter：`hooks/pre-tool-use.ts` 调用同一 gate；`codex-adapter/config.ts` 删除本地 matcher，改用 policy bare 模式 primitives。

### 3. 测试

- 先加 policy 级测试：`provider/model`、bare、trailing wildcard、lone `*`、case-sensitive、fail-open、marker rejection、reason prefix。
- host 测试改为断言 verdict 形状映射：OpenCode throw / parts rewrite，Claude `{block}` / `{kind:"block"|"none"}`，Codex `permissionDecision:"deny"`。
- acceptance：现有语义不变，`bun test` 全绿；`src/config.ts` 与两个 adapter config 不再各自实现 matcher。

## 错误处理

- model unknown：allow（与现状一致，guardrail not sandbox）。
- config 中非法 verifiedModels pattern：仍由各自 config validator 报错，但 validator 使用同一 `isValidVerifiedModelPattern` primitive。
- gate 不处理 sticky routing、session store、delegate spawn；那些保持在现有 modules。

## 成功标准

- 五处 gate copy 消失，policy decision 只在 `src/policy.ts`。
- matcher 只剩一份实现；config validators 共用 pattern primitive。
- 用户可见 reason 文案与 host verdict 形状不变。
- `bun test` 全绿。
