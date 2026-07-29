# A1 Deep Delegation Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Consolidate the verified-model gate and `GENERATED_MARKER` prompt-template rejection into one deep `src/policy.ts` delegation-gate module used by OpenCode, Claude Code adapter, and Codex adapter.

**Architecture:** `src/policy.ts` owns one `checkDelegationGate` decision interface plus the single wildcard matcher and pattern-validation primitives. Host modules only translate that decision into their native verdict shape (OpenCode throw/parts rewrite, Claude `{block}` / `{kind}`, Codex `permissionDecision`). Config search/load pipelines, delegate-turn, generated-file-sync, DoctorRun, and session lifecycle are explicitly out of scope.

**Tech Stack:** Bun, TypeScript, bun:test.

## Global Constraints

- `dist/` is committed; every `src/` change must be followed by `bun run build` and the `dist/` output must be included in the same commit.
- Gate order is the approved spec order: non-delegate target → allow; `GENERATED_MARKER` in a string prompt → deny; no `verifiedModels` or unknown model → allow; known unmatched model → deny. This makes OpenCode match Claude/Codex when both marker and unverified model are present.
- User-facing reason wording stays the same except for that approved both-conditions edge case; prefixes remain `[plugin]` for OpenCode and `[cli-dispatch]` for adapters.
- Do not change config search/load pipelines, delegate spawn flags, sticky routing, RESTRICTIVE_AGENTS, generated-file-sync, DoctorRun, or session lifecycle.
- Tests must run with `bun test` from the repo root.
- No release bump in this plan; release is deferred until the A batch is complete unless the user asks otherwise.

---

### Task 1: Policy gate primitives and decision interface

**Files:**
- Modify: `src/policy.ts`
- Test: `src/__tests__/policy.test.ts`

**Interfaces:**
- Consumes: existing `GENERATED_MARKER` from `src/policy.ts`.
- Produces:
  - `type ModelRef = string | { providerID: string; modelID: string }`
  - `type GateTarget = { kind: "command" | "tool"; delegate: string; tool?: string }`
  - `type GateDecision = { allow: true } | { allow: false; reason: string }`
  - `isValidVerifiedModelPattern(entry: unknown, mode: "provider-model" | "bare"): entry is string`
  - `matchesVerifiedModel(model: ModelRef, patterns: string[]): boolean`
  - `checkDelegationGate(input: { target: GateTarget; prompt?: unknown; model?: ModelRef; verifiedModels?: string[]; prefix: "[plugin]" | "[cli-dispatch]" }): GateDecision`

- [ ] **Step 1: Write the failing tests**

Append to `src/__tests__/policy.test.ts`:

```ts
import {
  checkDelegationGate,
  isValidVerifiedModelPattern,
  matchesVerifiedModel,
  type ModelRef,
} from "../policy"

describe("isValidVerifiedModelPattern", () => {
  it("accepts provider/model patterns only in provider-model mode", () => {
    expect(isValidVerifiedModelPattern("anthropic/claude-*", "provider-model")).toBe(true)
    expect(isValidVerifiedModelPattern("*/*", "provider-model")).toBe(true)
    expect(isValidVerifiedModelPattern("anthropic", "provider-model")).toBe(false)
    expect(isValidVerifiedModelPattern("anthropic/claude/extra", "provider-model")).toBe(false)
    expect(isValidVerifiedModelPattern("/claude", "provider-model")).toBe(false)
    expect(isValidVerifiedModelPattern(42, "provider-model")).toBe(false)
  })

  it("accepts bare patterns only in bare mode", () => {
    expect(isValidVerifiedModelPattern("claude-*", "bare")).toBe(true)
    expect(isValidVerifiedModelPattern("*", "bare")).toBe(true)
    expect(isValidVerifiedModelPattern("anthropic/claude-*", "bare")).toBe(false)
    expect(isValidVerifiedModelPattern("", "bare")).toBe(false)
    expect(isValidVerifiedModelPattern(null, "bare")).toBe(false)
  })
})

describe("matchesVerifiedModel", () => {
  const objectModel: ModelRef = { providerID: "anthropic", modelID: "claude-sonnet-4-5" }

  it("matches provider/model patterns against object models", () => {
    expect(matchesVerifiedModel(objectModel, ["anthropic/claude-sonnet-4-5"])).toBe(true)
    expect(matchesVerifiedModel(objectModel, ["anthropic/*"])).toBe(true)
    expect(matchesVerifiedModel(objectModel, ["*/claude-*"])).toBe(true)
    expect(matchesVerifiedModel(objectModel, ["minimax-cn/*"])).toBe(false)
    expect(matchesVerifiedModel(objectModel, ["Anthropic/*"])).toBe(false)
  })

  it("matches bare patterns against string models or object modelIDs", () => {
    expect(matchesVerifiedModel("claude-sonnet-5", ["claude-*"])).toBe(true)
    expect(matchesVerifiedModel("claude-sonnet-5", ["*"])).toBe(true)
    expect(matchesVerifiedModel(objectModel, ["claude-*"])).toBe(true)
    expect(matchesVerifiedModel(objectModel, ["anthropic"])).toBe(false)
    expect(matchesVerifiedModel("claude-sonnet-5", ["anthropic/claude-*"])).toBe(false)
    expect(matchesVerifiedModel(objectModel, [])).toBe(false)
  })
})

describe("checkDelegationGate", () => {
  it("allows when no verifiedModels are configured", () => {
    expect(
      checkDelegationGate({
        target: { kind: "tool", delegate: "claude", tool: "claude_start" },
        prompt: "hi",
        model: { providerID: "bad", modelID: "model" },
        prefix: "[plugin]",
      }),
    ).toEqual({ allow: true })
  })

  it("fails open when the model is unknown", () => {
    expect(
      checkDelegationGate({
        target: { kind: "command", delegate: "claude" },
        verifiedModels: ["anthropic/*"],
        prefix: "[plugin]",
      }),
    ).toEqual({ allow: true })
  })

  it("denies a known unmatched command model with command wording", () => {
    const decision = checkDelegationGate({
      target: { kind: "command", delegate: "claude" },
      model: { providerID: "minimax-cn", modelID: "MiniMax-M2.5" },
      verifiedModels: ["anthropic/*"],
      prefix: "[plugin]",
    })
    expect(decision.allow).toBe(false)
    if (!decision.allow) {
      expect(decision.reason).toContain("[plugin] The current model (minimax-cn/MiniMax-M2.5)")
      expect(decision.reason).toContain("claude was not started")
    }
  })

  it("denies a known unmatched tool model with tool wording", () => {
    const decision = checkDelegationGate({
      target: { kind: "tool", delegate: "claude", tool: "claude_reply" },
      model: "gpt-5.6-sol",
      verifiedModels: ["other-*"],
      prefix: "[cli-dispatch]",
    })
    expect(decision.allow).toBe(false)
    if (!decision.allow) {
      expect(decision.reason).toContain("[cli-dispatch] The current model (gpt-5.6-sol)")
      expect(decision.reason).toContain("claude_reply was blocked")
    }
  })

  it("rejects a string prompt containing the generated marker before the model gate", () => {
    const decision = checkDelegationGate({
      target: { kind: "tool", delegate: "claude", tool: "claude_start" },
      prompt: `hello\n${GENERATED_MARKER}`,
      model: "bad-model",
      verifiedModels: ["other-*"],
      prefix: "[cli-dispatch]",
    })
    expect(decision.allow).toBe(false)
    if (!decision.allow) {
      expect(decision.reason).toContain("claude_start rejected")
      expect(decision.reason).toContain("whole delegate command template")
    }
  })

  it("allows a non-string or missing prompt", () => {
    expect(
      checkDelegationGate({
        target: { kind: "tool", delegate: "claude", tool: "claude_start" },
        prompt: 42,
        verifiedModels: ["*"],
        model: "anything",
        prefix: "[plugin]",
      }),
    ).toEqual({ allow: true })
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test src/__tests__/policy.test.ts`
Expected: FAIL with `checkDelegationGate is not a function` / `isValidVerifiedModelPattern is not a function`.

- [ ] **Step 3: Implement the policy gate**

Append to `src/policy.ts`:

```ts
export type ModelRef = string | { providerID: string; modelID: string }

export type GateTarget = { kind: "command" | "tool"; delegate: string; tool?: string }

export type GateDecision = { allow: true } | { allow: false; reason: string }

const VERIFIED_MODEL_SEGMENT_RE = /^(\*|[\w.-]+\*?)$/

export function isValidVerifiedModelPattern(entry: unknown, mode: "provider-model" | "bare"): entry is string {
  if (typeof entry !== "string") return false
  const parts = entry.split("/")
  if (mode === "provider-model") {
    if (parts.length !== 2) return false
    return parts.every((part) => VERIFIED_MODEL_SEGMENT_RE.test(part))
  }
  return parts.length === 1 && VERIFIED_MODEL_SEGMENT_RE.test(entry)
}

function matchesSegment(actual: string, pattern: string): boolean {
  if (pattern === "*") return true
  if (pattern.endsWith("*")) return actual.startsWith(pattern.slice(0, -1))
  return actual === pattern
}

export function matchesVerifiedModel(model: ModelRef, patterns: string[]): boolean {
  return patterns.some((pattern) => {
    if (pattern.includes("/")) {
      if (typeof model === "string") return false
      const [provider, modelPattern] = pattern.split("/")
      return matchesSegment(model.providerID, provider) && matchesSegment(model.modelID, modelPattern)
    }
    const actual = typeof model === "string" ? model : model.modelID
    return matchesSegment(actual, pattern)
  })
}

function modelDisplay(model: ModelRef): string {
  return typeof model === "string" ? model : `${model.providerID}/${model.modelID}`
}

function targetLabel(target: GateTarget): { label: string; verb: string } {
  return target.kind === "command"
    ? { label: target.delegate, verb: "was not started" }
    : { label: target.tool ?? target.delegate, verb: "was blocked" }
}

export function checkDelegationGate(input: {
  target: GateTarget
  prompt?: unknown
  model?: ModelRef
  verifiedModels?: string[]
  prefix: "[plugin]" | "[cli-dispatch]"
}): GateDecision {
  if (typeof input.prompt === "string" && input.prompt.includes(GENERATED_MARKER)) {
    const tool = input.target.tool ?? input.target.delegate
    return {
      allow: false,
      reason: `${tool} rejected: the "prompt" argument contains the whole delegate command template instead of the user's actual message. Pass only the user's text as "prompt".`,
    }
  }

  const patterns = input.verifiedModels
  if (!patterns || patterns.length === 0 || !input.model) return { allow: true }
  if (matchesVerifiedModel(input.model, patterns)) return { allow: true }

  const { label, verb } = targetLabel(input.target)
  return {
    allow: false,
    reason: `${input.prefix} The current model (${modelDisplay(input.model)}) is not on the verified-models allow-list for CLI delegation, so ${label} ${verb}. Switch to a verified model and try again.`,
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test src/__tests__/policy.test.ts`
Expected: PASS.

- [ ] **Step 5: Build and commit**

Run:

```bash
bun run build
git add src/policy.ts src/__tests__/policy.test.ts dist
git commit -m "feat: add deep delegation gate policy"
```

Expected: commit succeeds.

---

### Task 2: OpenCode host uses the gate

**Files:**
- Modify: `src/config.ts:21-45,164-177`
- Modify: `src/hooks.ts:1-4,75-92,180-208`
- Test: `src/__tests__/hooks.test.ts`
- Test: `src/__tests__/config.test.ts`

**Interfaces:**
- Consumes: Task 1 `checkDelegationGate`, `matchesVerifiedModel`, `isValidVerifiedModelPattern`.
- Produces: OpenCode command/tool hooks whose behavior maps `GateDecision` to parts rewrite or thrown Error; `src/config.ts` re-exports policy matcher primitives for existing callers.

- [ ] **Step 1: Keep existing tests as the failing behavior contract**

Run: `bun test src/__tests__/hooks.test.ts src/__tests__/config.test.ts`
Expected: PASS before refactor. This is the behavior contract the refactor must preserve.

- [ ] **Step 2: Replace config matcher primitives with policy re-exports**

In `src/config.ts`, remove `VERIFIED_MODEL_SEGMENT_RE`, `isValidVerifiedModelEntry`, `matchesSegment`, and `matchesVerifiedModel`; add:

```ts
import { isValidVerifiedModelPattern, matchesVerifiedModel as matchesVerifiedModelPolicy } from "./policy"

export function isValidVerifiedModelEntry(entry: unknown): entry is string {
  return isValidVerifiedModelPattern(entry, "provider-model")
}

export function matchesVerifiedModel(model: { providerID: string; modelID: string }, patterns: string[]): boolean {
  return matchesVerifiedModelPolicy(model, patterns)
}
```

- [ ] **Step 3: Replace OpenCode hook gates with `checkDelegationGate`**

In `src/hooks.ts`, update imports:

```ts
import { type CliDispatchConfig } from "./config"
import { GENERATED_MARKER, checkDelegationGate } from "./policy"
```

Replace the model-gate block in `makeCommandBefore` with:

```ts
    const decision = checkDelegationGate({
      target: { kind: "command", delegate },
      model,
      verifiedModels: patterns,
      prefix: "[plugin]",
    })
    if (decision.allow) return

    output.parts.length = 0
    output.parts.push({ type: "text", text: decision.reason, synthetic: true })
```

Replace `makeToolExecuteBefore`'s body after the delegate-tool check with:

```ts
    const decision = checkDelegationGate({
      target: { kind: "tool", delegate: input.tool.replace(/_(start|reply)$/, ""), tool: input.tool },
      prompt: output.args?.prompt,
      model: getSessionModel(input.sessionID),
      verifiedModels: config.verifiedModels,
      prefix: "[plugin]",
    })
    if (!decision.allow) throw new Error(decision.reason)
```

- [ ] **Step 4: Run the behavior contract tests**

Run: `bun test src/__tests__/hooks.test.ts src/__tests__/config.test.ts`
Expected: PASS unchanged.

- [ ] **Step 5: Build and commit**

Run:

```bash
bun run build
git add src/config.ts src/hooks.ts dist
git commit -m "refactor: route opencode delegation gate through policy"
```

Expected: commit succeeds.

---

### Task 3: Claude Code adapter uses the gate

**Files:**
- Modify: `src/claude-code-adapter/config.ts:13-27,68-79`
- Modify: `src/claude-code-adapter/pretooluse-check.ts:21-49`
- Modify: `src/claude-code-adapter/userpromptsubmit-logic.ts:48-61`
- Test: `src/__tests__/claude-code-adapter-basics.test.ts`
- Test: `src/__tests__/claude-code-adapter-hooks.test.ts`

**Interfaces:**
- Consumes: Task 1 policy primitives.
- Produces: Claude adapter config re-exports bare matcher primitives; Claude hooks map `GateDecision` to `{block}` or `{kind:"block"}`.

- [ ] **Step 1: Keep existing tests as the failing behavior contract**

Run: `bun test src/__tests__/claude-code-adapter-basics.test.ts src/__tests__/claude-code-adapter-hooks.test.ts`
Expected: PASS before refactor.

- [ ] **Step 2: Replace adapter matcher primitives with policy re-exports**

In `src/claude-code-adapter/config.ts`, remove `MODEL_PATTERN_RE`, `isValidModelPattern`, and `matchesModelPattern`; add:

```ts
import { isValidVerifiedModelPattern, matchesVerifiedModel } from "../policy"

export function isValidModelPattern(entry: unknown): entry is string {
  return isValidVerifiedModelPattern(entry, "bare")
}

export function matchesModelPattern(model: string, patterns: string[]): boolean {
  return matchesVerifiedModel(model, patterns)
}
```

- [ ] **Step 3: Replace Claude hook gates**

In `src/claude-code-adapter/pretooluse-check.ts`, update imports:

```ts
import { GENERATED_MARKER, checkDelegationGate } from "../policy"
```

Replace the prompt/model blocks with:

```ts
  const delegate = input.tool_name!.replace(/^mcp__cli-dispatch__/, "").replace(/_(start|reply)$/, "")
  const decision = checkDelegationGate({
    target: { kind: "tool", delegate, tool: input.tool_name! },
    prompt,
    model,
    verifiedModels: patterns,
    prefix: "[cli-dispatch]",
  })
  return decision.allow ? { block: false } : { block: true, reason: decision.reason }
```

Keep the existing `model` derivation (`input.transcript_path ? getCurrentModel(input.transcript_path) : undefined`) before calling the gate.

In `src/claude-code-adapter/userpromptsubmit-logic.ts`, update imports:

```ts
import { checkDelegationGate } from "../policy"
```

Replace the delegate-start gate block with:

```ts
    const model = input.transcript_path ? getCurrentModel(input.transcript_path) : undefined
    const decision = checkDelegationGate({
      target: { kind: "command", delegate: target },
      model,
      verifiedModels: patterns,
      prefix: "[cli-dispatch]",
    })
    return decision.allow ? { kind: "none" } : { kind: "block", reason: decision.reason }
```

- [ ] **Step 4: Run the behavior contract tests**

Run: `bun test src/__tests__/claude-code-adapter-basics.test.ts src/__tests__/claude-code-adapter-hooks.test.ts`
Expected: PASS unchanged.

- [ ] **Step 5: Build and commit**

Run:

```bash
bun run build
git add src/claude-code-adapter/config.ts src/claude-code-adapter/pretooluse-check.ts src/claude-code-adapter/userpromptsubmit-logic.ts dist
git commit -m "refactor: route claude adapter delegation gate through policy"
```

Expected: commit succeeds.

---

### Task 4: Codex adapter uses the gate

**Files:**
- Modify: `src/codex-adapter/config.ts:13-25,39-52`
- Modify: `src/codex-adapter/hooks/pre-tool-use.ts:23-51`
- Test: `src/__tests__/codex-adapter-config.test.ts`
- Test: `src/__tests__/codex-adapter-hooks.test.ts`

**Interfaces:**
- Consumes: Task 1 policy primitives.
- Produces: Codex adapter config re-exports bare matcher primitives; Codex PreToolUse maps `GateDecision` to `permissionDecision:"deny"`.

- [ ] **Step 1: Keep existing tests as the failing behavior contract**

Run: `bun test src/__tests__/codex-adapter-config.test.ts src/__tests__/codex-adapter-hooks.test.ts`
Expected: PASS before refactor.

- [ ] **Step 2: Replace adapter matcher primitives with policy re-exports**

In `src/codex-adapter/config.ts`, remove `MODEL_PATTERN_RE`, `isValidModelPattern`, and `matchesModelPattern`; add:

```ts
import { isValidVerifiedModelPattern, matchesVerifiedModel } from "../policy"

export function isValidModelPattern(entry: unknown): entry is string {
  return isValidVerifiedModelPattern(entry, "bare")
}

export function matchesModelPattern(model: string, patterns: string[]): boolean {
  return matchesVerifiedModel(model, patterns)
}
```

- [ ] **Step 3: Replace Codex PreToolUse gate**

In `src/codex-adapter/hooks/pre-tool-use.ts`, update imports:

```ts
import { GENERATED_MARKER, checkDelegationGate } from "../../policy"
```

Replace the prompt/model blocks with:

```ts
  const delegate = input.tool_name!.replace(/^mcp__cli_dispatch__/, "").replace(/_(start|reply)$/, "")
  const decision = checkDelegationGate({
    target: { kind: "tool", delegate, tool: input.tool_name! },
    prompt,
    model,
    verifiedModels: patterns,
    prefix: "[cli-dispatch]",
  })
  if (decision.allow) return undefined
  return {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: decision.reason,
    },
  }
```

- [ ] **Step 4: Run the behavior contract tests**

Run: `bun test src/__tests__/codex-adapter-config.test.ts src/__tests__/codex-adapter-hooks.test.ts`
Expected: PASS unchanged.

- [ ] **Step 5: Build and commit**

Run:

```bash
bun run build
git add src/codex-adapter/config.ts src/codex-adapter/hooks/pre-tool-use.ts dist
git commit -m "refactor: route codex adapter delegation gate through policy"
```

Expected: commit succeeds.

---

### Task 5: Full verification and duplication audit

**Files:**
- Modify if build output changes: `dist/**`
- Verify only: no source edits expected

**Interfaces:**
- Consumes: Tasks 1-4.
- Produces: green full suite, fresh `dist/`, and a duplication audit showing one matcher and one gate decision.

- [ ] **Step 1: Run the full test suite**

Run: `bun test`
Expected: PASS.

- [ ] **Step 2: Run the dev-env and isolated suites**

Run: `bun run test:dev && bun run test:isolated`
Expected: PASS.

- [ ] **Step 3: Rebuild dist**

Run: `bun run build`
Expected: TypeScript build completes; commit `dist/` if it changed.

- [ ] **Step 4: Audit duplication**

Run:

```bash
rg "matchesSegment|matchesModelPattern|GENERATED_MARKER.*includes|verified-models allow-list" src --glob '!**/__tests__/**'
```

Expected: matcher implementation only in `src/policy.ts`; adapter/config files only re-export or call policy; reason wording only in `src/policy.ts` except host-specific non-gate messages.

- [ ] **Step 5: Commit build output if needed**

Run:

```bash
git status --short
git add dist
git commit -m "chore: rebuild dist for deep delegation gate"
```

Expected: commit succeeds if `dist/` changed; otherwise skip and record clean status in the final summary.

## Self-Review

- Spec coverage: Task 1 implements the deep gate and matcher/validation primitives; Tasks 2-4 route OpenCode, Claude, and Codex hosts through it; Task 5 verifies the full matrix and duplication audit.
- Placeholder scan: no TBD/TODO; each code-changing step includes exact code or exact replacement text.
- Type consistency: `ModelRef`, `GateTarget`, `GateDecision`, `isValidVerifiedModelPattern`, `matchesVerifiedModel`, and `checkDelegationGate` are used with the same names in Tasks 1-4.
