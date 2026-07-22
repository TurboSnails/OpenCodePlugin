# Claude Code Host Adapter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let Claude Code itself delegate a conversation to `codex` or `opencode` headlessly (`/codex`, `/opencode`), stay sticky on follow-ups, and return to Claude Code via `/cc` — the same sticky-routing/verified-models/prompt-sanitization contract this repo already ships for OpenCode, reimplemented on Claude Code's own extensibility primitives (MCP server + `PreToolUse`/`UserPromptSubmit` hooks) instead of OpenCode's plugin API.

**Architecture:** An MCP server (`src/claude-code-adapter/mcp-server.ts`) registers four tools (`codex_start`/`codex_reply`/`opencode_start`/`opencode_reply`), each calling the existing host-agnostic `runDelegate` (`src/run-delegate.ts`). A `PreToolUse` hook rejects prompt-template-forwarding the same way `tool.execute.before` does for OpenCode. A `UserPromptSubmit` hook detects delegate-start/home commands, applies a `verifiedModels` gate, and injects the sticky routing rule on follow-ups — all backed by a new file-backed session store (Claude Code hooks are separate short-lived processes, unlike OpenCode's single long-lived plugin process, so there's no shared in-memory state to reuse).

**Tech Stack:** TypeScript, Bun (`bun test`), `@modelcontextprotocol/sdk` + `zod` (new runtime dependencies), Claude Code 2.1.215 hook/MCP contract.

**Spec:** `openspec/changes/claude-code-host-adapter/` (proposal.md, design.md, specs/claude-code-host-adapter/spec.md, specs/config-driven-delegates/spec.md, tasks.md).

## Global Constraints

- Claude Code version verified against: **2.1.215**. MCP tool names appear in hook payloads as `mcp__<serverName>__<toolName>`; this adapter's MCP server is named `"cli-dispatch"`, so the four tools appear as `mcp__cli-dispatch__codex_start`, `mcp__cli-dispatch__codex_reply`, `mcp__cli-dispatch__opencode_start`, `mcp__cli-dispatch__opencode_reply` (verified live, 2026-07-21).
- `PreToolUse` hook stdin JSON shape (verified live): `{"session_id": string, "transcript_path": string, "cwd": string, "prompt_id": string, "permission_mode": string, "hook_event_name": "PreToolUse", "tool_name": string, "tool_input": Record<string, unknown>, "tool_use_id": string}`. Exit code `2` + stderr text blocks the tool call before its handler runs (verified: handler-side log file never created).
- `UserPromptSubmit` hook stdin JSON shape (verified live): `{"session_id": string, "transcript_path": string, "cwd": string, "prompt_id": string, "permission_mode": string, "hook_event_name": "UserPromptSubmit", "prompt": string}` — **no model field**. `prompt` is the raw, unexpanded text the user typed (verified: a real `/codex do the thing` custom slash command still delivered `"prompt":"/codex do the thing"` to this hook, not the expanded template body). Exit code `0` + stdout text is injected as additive context the model can act on (verified working for legitimately-worded routing text; adversarially-worded text gets refused by the model as suspected injection — not a hook failure). Exit code `2` + stderr fully suppresses the turn: `num_turns: 0`, zero token usage, no model call at all — the CLI's own result becomes the hook's stderr message, deterministically, no model relay involved.
- Current model discovery: neither hook payload names it. The `transcript_path` JSONL file's last `{"type":"assistant","message":{"model": string}}` line is the substitute (verified live: `"model":"claude-sonnet-5"`). No such line exists before a session's first assistant turn — fail open (do not block) in that case, exactly as this repo's `harden-sticky-routing` change already established for OpenCode's analogous first-message case.
- MCP tool handlers do not receive Claude Code's session id via the MCP request (`extra.sessionId` is present as a key but `undefined` for stdio transport — verified live). The MCP server subprocess's own `process.env.CLAUDE_CODE_SESSION_ID` is confirmed identical to the hooks' `session_id` and is what tool handlers use to key the file-backed store.
- `verifiedModels` on this adapter is a **bare array of model-string patterns** (e.g. `["claude-*"]`), not `provider/model` pairs like OpenCode's `src/config.ts` — Claude Code doesn't expose a provider dimension the hooks can see. Do not reuse `src/config.ts`'s `matchesVerifiedModel`/`isValidVerifiedModelEntry` for this; this adapter has its own single-segment matcher.
- Reuse without modification: `runDelegate`/`defaultSpawn` (`src/run-delegate.ts`), `getParser`/`PARSERS` (`src/parse-events.ts`, after Task 1 adds the `"opencode"` entry), `GENERATED_MARKER` (`src/commands.ts`), `DelegateConfig`/`resolveArgs` (`src/config.ts`).
- Reuse with an additive, backward-compatible change: `buildRoutingRule` (`src/routing-rule.ts`) gains an optional second parameter; existing single-argument OpenCode call sites are unaffected (Task 3).
- All new source lives under `src/claude-code-adapter/`. Tests live in `src/__tests__/` alongside the existing suite, prefixed `claude-code-` to avoid name collisions with the OpenCode-side files of the same short name (e.g. `claude-code-session-store.test.ts` vs. the existing `session-store.test.ts`).
- Run tests with `bun test` from the repo root (currently 123 pass, 0 fail before this plan's changes). Build with `bun run build` (`tsc`) — `dist/` is committed and must be rebuilt in the same commit as any `src/` change (existing repo convention, see README's "Building a package" section).
- Commit style: conventional (`feat:`, `fix:`, `docs:`, `chore:`), matching `git log` in this repo.

---

### Task 1: `"opencode"` parser in the shared core

**Files:**
- Modify: `src/parse-events.ts`
- Modify: `src/config.ts` (`ParserName` union only — the `validateDelegates` extraction is Task 2)
- Test: `src/__tests__/parse-events.test.ts`

**Interfaces:**
- Consumes: nothing new
- Produces: `parseOpencodeLine(line: string): ParsedLine`, registered in `PARSERS.opencode`; `ParserName` includes `"opencode"` — consumed by Task 6 (`startDelegate`/`replyDelegate` pass `parser: "opencode"` for the opencode delegate)

- [ ] **Step 1: Write the failing test**

Add to `src/__tests__/parse-events.test.ts`, inside the existing `for (const parserName of ["claude", "codex"] as const)` loop, change it to include `"opencode"`:

```ts
for (const parserName of ["claude", "codex", "opencode"] as const) {
```

Then add a new `describe` block after the existing `describe("codex parser", ...)` block:

```ts
describe("opencode parser", () => {
  const parser = getParser("opencode")

  it("extracts the session id from any event line", () => {
    const line = JSON.stringify({
      type: "step_start",
      sessionID: "ses_abc123",
      part: { type: "step-start" },
    })
    const result = parser(line)
    expect(result.externalId).toBe("ses_abc123")
  })

  it("accumulates text events as final text, in order", () => {
    const first = parser(JSON.stringify({ type: "text", sessionID: "ses_1", part: { type: "text", text: "Hello" } }))
    expect(first.finalText).toBe("Hello")
    expect(first.appendFinalText).toBe(true)

    const second = parser(JSON.stringify({ type: "text", sessionID: "ses_1", part: { type: "text", text: "World" } }))
    expect(second.finalText).toBe("World")
    expect(second.appendFinalText).toBe(true)
  })

  it("surfaces text events as progress too", () => {
    const line = JSON.stringify({ type: "text", sessionID: "ses_1", part: { type: "text", text: "working..." } })
    const result = parser(line)
    expect(result.progressText).toBe("working...")
  })

  it("ignores unrelated event types", () => {
    const line = JSON.stringify({ type: "step_finish", sessionID: "ses_1", part: { type: "step-finish" } })
    const result = parser(line)
    expect(result.finalText).toBeUndefined()
    expect(result.progressText).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/__tests__/parse-events.test.ts`
Expected: FAIL — `Error: Unknown parser: opencode` (or similar), since `"opencode"` isn't a valid `ParserName` yet and `getParser` falls back to `raw`, which won't produce the expected `externalId`/accumulation behavior.

- [ ] **Step 3: Write minimal implementation**

In `src/config.ts`, change:

```ts
export type ParserName = "claude" | "codex" | "raw"
```

to:

```ts
export type ParserName = "claude" | "codex" | "opencode" | "raw"
```

And in `validateConfig`, change:

```ts
    if (typeof d.parser !== "string" || !["claude", "codex", "raw"].includes(d.parser)) {
      errors.push(`delegate "${name}": "parser" must be "claude", "codex", or "raw"`)
    }
```

to:

```ts
    if (typeof d.parser !== "string" || !["claude", "codex", "opencode", "raw"].includes(d.parser)) {
      errors.push(`delegate "${name}": "parser" must be "claude", "codex", "opencode", or "raw"`)
    }
```

In `src/parse-events.ts`, add after `parseCodexLine` and before `parseRawLine`:

```ts
function parseOpencodeLine(line: string): ParsedLine {
  let obj: unknown
  try {
    obj = JSON.parse(line)
  } catch {
    return { progressText: line }
  }

  if (!isEventObject(obj)) return {}

  const externalId = typeof obj.sessionID === "string" ? obj.sessionID : undefined

  if (obj.type === "text" && typeof obj.part?.text === "string") {
    return { externalId, progressText: obj.part.text, finalText: obj.part.text, appendFinalText: true }
  }

  return externalId ? { externalId } : {}
}
```

Update `PARSERS`:

```ts
const PARSERS: Record<ParserName, LineParser> = {
  claude: parseClaudeLine,
  codex: parseCodexLine,
  opencode: parseOpencodeLine,
  raw: parseRawLine,
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/__tests__/parse-events.test.ts`
Expected: PASS (all `opencode parser` tests, plus the existing `claude`/`codex`/malformed-input tests now also covering `"opencode"` in the shared malformed-events loop)

- [ ] **Step 5: Run the full suite to confirm no regression**

Run: `bun test`
Expected: all previously-passing tests still pass (config.ts's `ParserName` change is additive; no existing delegate config specifies `"opencode"` so no behavior changes for `claude`/`codex`/`raw`)

- [ ] **Step 6: Commit**

```bash
git add src/config.ts src/parse-events.ts src/__tests__/parse-events.test.ts
git commit -m "feat: add opencode parser for delegating to opencode headlessly"
```

---

### Task 2: Extract `validateDelegates` for reuse

**Files:**
- Modify: `src/config.ts`
- Test: `src/__tests__/config.test.ts` (no new tests needed — this step must not change any existing test's behavior; it's a pure refactor)

**Interfaces:**
- Consumes: nothing new
- Produces: `export function validateDelegates(delegates: Record<string, unknown>): string[]` — consumed by Task 4 (`loadAdapterConfig`)

- [ ] **Step 1: Run the existing config tests to establish the pre-refactor baseline**

Run: `bun test src/__tests__/config.test.ts`
Expected: PASS (all existing tests green before touching anything)

- [ ] **Step 2: Extract the per-delegate validation loop**

In `src/config.ts`, find the loop inside `validateConfig`:

```ts
  const delegates = obj.delegates as Record<string, unknown>
  for (const [name, delegate] of Object.entries(delegates)) {
    if (!/^[\w-]+$/.test(name)) {
      errors.push(`delegate "${name}": name must match /^[\\w-]+$/ (letters, digits, underscore, hyphen) or it would produce invalid tool names`)
    }

    if (typeof delegate !== "object" || delegate === null) {
      errors.push(`delegate "${name}": must be an object`)
      continue
    }

    const d = delegate as Record<string, unknown>
    if (typeof d.binary !== "string") {
      errors.push(`delegate "${name}": missing or invalid "binary" field`)
    }

    if (typeof d.parser !== "string" || !["claude", "codex", "opencode", "raw"].includes(d.parser)) {
      errors.push(`delegate "${name}": "parser" must be "claude", "codex", "opencode", or "raw"`)
    }

    if (!Array.isArray(d.startArgs) || !d.startArgs.every((a) => typeof a === "string")) {
      errors.push(`delegate "${name}": "startArgs" must be an array of strings`)
    } else if (!d.startArgs.some((a) => a.includes("{prompt}"))) {
      errors.push(`delegate "${name}": "startArgs" must contain the {prompt} placeholder, otherwise the CLI runs without the user's task`)
    }

    if (!Array.isArray(d.replyArgs) || !d.replyArgs.every((a) => typeof a === "string")) {
      errors.push(`delegate "${name}": "replyArgs" must be an array of strings`)
    } else if (!d.replyArgs.some((a) => a.includes("{externalId}"))) {
      console.warn(`[cli-dispatch] delegate "${name}": "replyArgs" has no {externalId} placeholder; ${name}_reply will not be able to resume a session`)
    }

    if (d.timeoutMs !== undefined && (typeof d.timeoutMs !== "number" || !(d.timeoutMs > 0))) {
      errors.push(`delegate "${name}": "timeoutMs" must be a positive number`)
    }
  }

  return errors
}
```

Replace it with a call to a new exported function, and define that function directly above `validateConfig`:

```ts
export function validateDelegates(delegates: Record<string, unknown>): string[] {
  const errors: string[] = []

  for (const [name, delegate] of Object.entries(delegates)) {
    if (!/^[\w-]+$/.test(name)) {
      errors.push(`delegate "${name}": name must match /^[\\w-]+$/ (letters, digits, underscore, hyphen) or it would produce invalid tool names`)
    }

    if (typeof delegate !== "object" || delegate === null) {
      errors.push(`delegate "${name}": must be an object`)
      continue
    }

    const d = delegate as Record<string, unknown>
    if (typeof d.binary !== "string") {
      errors.push(`delegate "${name}": missing or invalid "binary" field`)
    }

    if (typeof d.parser !== "string" || !["claude", "codex", "opencode", "raw"].includes(d.parser)) {
      errors.push(`delegate "${name}": "parser" must be "claude", "codex", "opencode", or "raw"`)
    }

    if (!Array.isArray(d.startArgs) || !d.startArgs.every((a) => typeof a === "string")) {
      errors.push(`delegate "${name}": "startArgs" must be an array of strings`)
    } else if (!d.startArgs.some((a) => a.includes("{prompt}"))) {
      errors.push(`delegate "${name}": "startArgs" must contain the {prompt} placeholder, otherwise the CLI runs without the user's task`)
    }

    if (!Array.isArray(d.replyArgs) || !d.replyArgs.every((a) => typeof a === "string")) {
      errors.push(`delegate "${name}": "replyArgs" must be an array of strings`)
    } else if (!d.replyArgs.some((a) => a.includes("{externalId}"))) {
      console.warn(`[cli-dispatch] delegate "${name}": "replyArgs" has no {externalId} placeholder; ${name}_reply will not be able to resume a session`)
    }

    if (d.timeoutMs !== undefined && (typeof d.timeoutMs !== "number" || !(d.timeoutMs > 0))) {
      errors.push(`delegate "${name}": "timeoutMs" must be a positive number`)
    }
  }

  return errors
}
```

And in `validateConfig`, replace the now-removed loop with:

```ts
  const delegates = obj.delegates as Record<string, unknown>
  errors.push(...validateDelegates(delegates))

  return errors
}
```

- [ ] **Step 3: Run the existing config tests to confirm the refactor is behavior-preserving**

Run: `bun test src/__tests__/config.test.ts`
Expected: PASS — identical results to Step 1's baseline (same error messages, same pass/fail per test), since this is a pure extraction with no logic change.

- [ ] **Step 4: Run the full suite**

Run: `bun test`
Expected: all tests still pass

- [ ] **Step 5: Commit**

```bash
git add src/config.ts
git commit -m "refactor: extract validateDelegates for reuse by the claude code adapter"
```

---

### Task 3: `buildRoutingRule`'s optional tool-name override

**Files:**
- Modify: `src/routing-rule.ts`
- Test: `src/__tests__/routing-rule.test.ts`

**Interfaces:**
- Consumes: nothing new
- Produces: `buildRoutingRule(delegate: string, replyTool?: string): string` — consumed by Task 8 (`decideUserPromptSubmit` calls `buildRoutingRule(name, \`mcp__cli-dispatch__${name}_reply\`)`)

- [ ] **Step 1: Write the failing test**

Read `src/__tests__/routing-rule.test.ts` first to match its existing style, then add:

```ts
it("uses a custom reply tool name when provided", () => {
  const rule = buildRoutingRule("codex", "mcp__cli-dispatch__codex_reply")
  expect(rule).toContain("mcp__cli-dispatch__codex_reply")
  expect(rule).not.toContain("codex_reply tool.")
})

it("defaults the reply tool name to `${delegate}_reply` when not provided", () => {
  const rule = buildRoutingRule("codex")
  expect(rule).toContain("codex_reply")
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/__tests__/routing-rule.test.ts`
Expected: FAIL on the first new test — `buildRoutingRule` currently only accepts one argument, so `rule` contains `"codex_reply"` instead of `"mcp__cli-dispatch__codex_reply"`.

- [ ] **Step 3: Write minimal implementation**

In `src/routing-rule.ts`, change:

```ts
export function buildRoutingRule(delegate: string): string {
  return [
    `DELEGATION ACTIVE: this conversation is delegated to the ${delegate} CLI.`,
    `Take the user's latest message verbatim — including any command-injected instructions — and pass it as the "prompt" argument to the ${delegate}_reply tool.`,
    `Return the tool's output to the user without adding your own commentary.`,
    `Do not answer the message yourself, even if other instructions tell you to.`,
    `Exception: if the latest message is another delegate command, follow that command's instructions instead — it switches or restarts the delegation.`,
  ].join(" ")
}
```

to:

```ts
export function buildRoutingRule(delegate: string, replyTool: string = `${delegate}_reply`): string {
  return [
    `DELEGATION ACTIVE: this conversation is delegated to the ${delegate} CLI.`,
    `Take the user's latest message verbatim — including any command-injected instructions — and pass it as the "prompt" argument to the ${replyTool} tool.`,
    `Return the tool's output to the user without adding your own commentary.`,
    `Do not answer the message yourself, even if other instructions tell you to.`,
    `Exception: if the latest message is another delegate command, follow that command's instructions instead — it switches or restarts the delegation.`,
  ].join(" ")
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/__tests__/routing-rule.test.ts`
Expected: PASS, including all pre-existing single-argument tests (default parameter preserves behavior)

- [ ] **Step 5: Run the full suite**

Run: `bun test`
Expected: all tests pass (OpenCode's `makeSystemTransform` in `src/hooks.ts` calls `buildRoutingRule(active.delegate)` with one argument — unaffected by the new optional second parameter)

- [ ] **Step 6: Commit**

```bash
git add src/routing-rule.ts src/__tests__/routing-rule.test.ts
git commit -m "feat: let buildRoutingRule take a custom reply-tool name"
```

---

### Task 4: Model discovery from the Claude Code transcript

**Files:**
- Create: `src/claude-code-adapter/current-model.ts`
- Test: `src/__tests__/claude-code-current-model.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `getCurrentModel(transcriptPath: string): string | undefined` — consumed by Task 8 (`decideUserPromptSubmit`)

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/claude-code-current-model.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"
import { getCurrentModel } from "../claude-code-adapter/current-model"

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "cli-dispatch-transcript-test-"))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe("getCurrentModel", () => {
  it("returns undefined when the transcript file doesn't exist", () => {
    expect(getCurrentModel(join(dir, "nonexistent.jsonl"))).toBeUndefined()
  })

  it("returns undefined when no assistant line has a model yet", () => {
    const path = join(dir, "transcript.jsonl")
    writeFileSync(path, `${JSON.stringify({ type: "queue-operation", operation: "enqueue" })}\n`)
    expect(getCurrentModel(path)).toBeUndefined()
  })

  it("extracts the model from a single assistant line", () => {
    const path = join(dir, "transcript.jsonl")
    writeFileSync(path, `${JSON.stringify({ type: "assistant", message: { model: "claude-sonnet-5" } })}\n`)
    expect(getCurrentModel(path)).toBe("claude-sonnet-5")
  })

  it("returns the model from the last assistant line when there are several", () => {
    const path = join(dir, "transcript.jsonl")
    const lines = [
      { type: "assistant", message: { model: "claude-sonnet-5" } },
      { type: "queue-operation", operation: "enqueue" },
      { type: "assistant", message: { model: "claude-opus-4-8" } },
    ]
    writeFileSync(path, lines.map((l) => JSON.stringify(l)).join("\n") + "\n")
    expect(getCurrentModel(path)).toBe("claude-opus-4-8")
  })

  it("skips malformed lines without throwing", () => {
    const path = join(dir, "transcript.jsonl")
    writeFileSync(path, `not json\n${JSON.stringify({ type: "assistant", message: { model: "claude-sonnet-5" } })}\n`)
    expect(() => getCurrentModel(path)).not.toThrow()
    expect(getCurrentModel(path)).toBe("claude-sonnet-5")
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/__tests__/claude-code-current-model.test.ts`
Expected: FAIL — `Cannot find module "../claude-code-adapter/current-model"`

- [ ] **Step 3: Write minimal implementation**

Create `src/claude-code-adapter/current-model.ts`:

```ts
import { readFileSync, existsSync } from "fs"

export function getCurrentModel(transcriptPath: string): string | undefined {
  if (!existsSync(transcriptPath)) return undefined

  const lines = readFileSync(transcriptPath, "utf-8").split("\n")
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim()
    if (!line) continue

    let obj: unknown
    try {
      obj = JSON.parse(line)
    } catch {
      continue
    }

    if (typeof obj !== "object" || obj === null) continue
    const record = obj as Record<string, unknown>
    if (record.type !== "assistant") continue

    const message = record.message as Record<string, unknown> | undefined
    if (message && typeof message.model === "string") return message.model
  }

  return undefined
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/__tests__/claude-code-current-model.test.ts`
Expected: PASS, 5 tests

- [ ] **Step 5: Commit**

```bash
git add src/claude-code-adapter/current-model.ts src/__tests__/claude-code-current-model.test.ts
git commit -m "feat: read the current model from a claude code transcript file"
```

---

### Task 5: Claude Code adapter config

**Files:**
- Create: `src/claude-code-adapter/config.ts`
- Test: `src/__tests__/claude-code-config.test.ts`

**Interfaces:**
- Consumes: `validateDelegates(delegates: Record<string, unknown>): string[]` (Task 2), `DelegateConfig`/`resolveArgs` from `../config`
- Produces: `ClaudeCodeAdapterConfig` type, `MCP_SERVER_NAME` constant, `isValidModelPattern(entry: unknown): entry is string`, `matchesModelPattern(model: string, patterns: string[]): boolean`, `loadAdapterConfig(configPath?: string): ClaudeCodeAdapterConfig` — consumed by Task 8 (`decideUserPromptSubmit`), Task 9 (`mcp-server.ts`), Task 10 (CLI wrappers), Task 7 (`checkPreToolUse`)

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/claude-code-config.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { writeFileSync, mkdtempSync, rmSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"
import { loadAdapterConfig, isValidModelPattern, matchesModelPattern } from "../claude-code-adapter/config"

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "cli-dispatch-adapter-config-test-"))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe("isValidModelPattern", () => {
  it("accepts a bare model string", () => {
    expect(isValidModelPattern("claude-sonnet-5")).toBe(true)
  })

  it("accepts a trailing wildcard", () => {
    expect(isValidModelPattern("claude-*")).toBe(true)
    expect(isValidModelPattern("*")).toBe(true)
  })

  it("rejects non-string entries", () => {
    expect(isValidModelPattern(42)).toBe(false)
    expect(isValidModelPattern(null)).toBe(false)
  })

  it("rejects an empty string", () => {
    expect(isValidModelPattern("")).toBe(false)
  })
})

describe("matchesModelPattern", () => {
  it("matches an exact string", () => {
    expect(matchesModelPattern("claude-sonnet-5", ["claude-sonnet-5"])).toBe(true)
  })

  it("matches a trailing wildcard", () => {
    expect(matchesModelPattern("claude-sonnet-5", ["claude-*"])).toBe(true)
  })

  it("does not match an unrelated pattern", () => {
    expect(matchesModelPattern("claude-sonnet-5", ["gpt-*"])).toBe(false)
  })

  it("is case-sensitive", () => {
    expect(matchesModelPattern("claude-sonnet-5", ["Claude-*"])).toBe(false)
  })

  it("returns false for an empty pattern list", () => {
    expect(matchesModelPattern("claude-sonnet-5", [])).toBe(false)
  })
})

describe("loadAdapterConfig", () => {
  it("loads a valid config", () => {
    const path = join(dir, "config.json")
    writeFileSync(
      path,
      JSON.stringify({
        delegates: {
          codex: { binary: "codex", parser: "codex", startArgs: ["exec", "--", "{prompt}"], replyArgs: ["exec", "resume", "{externalId}", "--", "{prompt}"] },
        },
        verifiedModels: ["claude-*"],
      }),
    )
    const config = loadAdapterConfig(path)
    expect(config.delegates.codex.binary).toBe("codex")
    expect(config.verifiedModels).toEqual(["claude-*"])
  })

  it("throws when the config file doesn't exist", () => {
    expect(() => loadAdapterConfig(join(dir, "nonexistent.json"))).toThrow(/not found/)
  })

  it("throws on invalid JSON", () => {
    const path = join(dir, "bad.json")
    writeFileSync(path, "{ invalid")
    expect(() => loadAdapterConfig(path)).toThrow(/Failed to parse/)
  })

  it("throws on an invalid delegate, reusing validateDelegates", () => {
    const path = join(dir, "bad-delegate.json")
    writeFileSync(path, JSON.stringify({ delegates: { codex: { binary: "codex" } } }))
    expect(() => loadAdapterConfig(path)).toThrow(/parser/)
  })

  it("throws on an invalid verifiedModels entry", () => {
    const path = join(dir, "bad-verified-models.json")
    writeFileSync(
      path,
      JSON.stringify({
        delegates: { codex: { binary: "codex", parser: "codex", startArgs: ["{prompt}"], replyArgs: ["{externalId}"] } },
        verifiedModels: [42],
      }),
    )
    expect(() => loadAdapterConfig(path)).toThrow(/verifiedModels/)
  })

  it("allows an absent verifiedModels field", () => {
    const path = join(dir, "no-verified-models.json")
    writeFileSync(
      path,
      JSON.stringify({
        delegates: { codex: { binary: "codex", parser: "codex", startArgs: ["{prompt}"], replyArgs: ["{externalId}"] } },
      }),
    )
    const config = loadAdapterConfig(path)
    expect(config.verifiedModels).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/__tests__/claude-code-config.test.ts`
Expected: FAIL — `Cannot find module "../claude-code-adapter/config"`

- [ ] **Step 3: Write minimal implementation**

Create `src/claude-code-adapter/config.ts`:

```ts
import { readFileSync, existsSync } from "fs"
import { validateDelegates, type DelegateConfig } from "../config"

export const MCP_SERVER_NAME = "cli-dispatch"
export const MCP_TOOL_PREFIX = `mcp__${MCP_SERVER_NAME}__`

export interface ClaudeCodeAdapterConfig {
  delegates: Record<string, DelegateConfig>
  verifiedModels?: string[]
}

const MODEL_PATTERN_RE = /^(\*|[\w.-]+\*?)$/

export function isValidModelPattern(entry: unknown): entry is string {
  return typeof entry === "string" && entry.length > 0 && MODEL_PATTERN_RE.test(entry)
}

export function matchesModelPattern(model: string, patterns: string[]): boolean {
  return patterns.some((pattern) => {
    if (pattern === "*") return true
    if (pattern.endsWith("*")) return model.startsWith(pattern.slice(0, -1))
    return model === pattern
  })
}

function validateAdapterConfig(config: unknown): string[] {
  const errors: string[] = []

  if (typeof config !== "object" || config === null) {
    return ["config must be an object"]
  }

  const obj = config as Record<string, unknown>
  if (typeof obj.delegates !== "object" || obj.delegates === null) {
    return ['"delegates" must be an object']
  }

  if (obj.verifiedModels !== undefined) {
    if (!Array.isArray(obj.verifiedModels)) {
      errors.push('"verifiedModels" must be an array of model-name strings')
    } else {
      for (const entry of obj.verifiedModels) {
        if (!isValidModelPattern(entry)) {
          errors.push(`"verifiedModels" entry ${JSON.stringify(entry)} must be a model-name string, optionally ending in a trailing "*" wildcard`)
        }
      }
    }
  }

  errors.push(...validateDelegates(obj.delegates as Record<string, unknown>))
  return errors
}

export function loadAdapterConfig(configPath?: string): ClaudeCodeAdapterConfig {
  const path = configPath ?? `${process.cwd()}/claude-code-adapter.config.json`

  if (!existsSync(path)) {
    throw new Error(`Claude Code adapter config not found at ${path}. Create it with at least a "delegates" object (e.g. codex/opencode).`)
  }

  const raw = readFileSync(path, "utf-8")
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (err) {
    throw new Error(`Failed to parse config at ${path}: ${err instanceof Error ? err.message : String(err)}`)
  }

  const errors = validateAdapterConfig(parsed)
  if (errors.length > 0) {
    throw new Error(`Invalid config at ${path}:\n  - ${errors.join("\n  - ")}`)
  }

  return parsed as ClaudeCodeAdapterConfig
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/__tests__/claude-code-config.test.ts`
Expected: PASS, all tests

- [ ] **Step 5: Commit**

```bash
git add src/claude-code-adapter/config.ts src/__tests__/claude-code-config.test.ts
git commit -m "feat: add claude code adapter config loader and model-pattern matcher"
```

---

### Task 6: File-backed session store

**Files:**
- Create: `src/claude-code-adapter/session-store.ts`
- Test: `src/__tests__/claude-code-session-store.test.ts`

**Interfaces:**
- Consumes: nothing new
- Produces: `getActiveDelegate(sessionId: string): {delegate: string; externalId: string} | undefined`, `setActiveDelegate(sessionId: string, delegate: string, externalId: string): void`, `clearActiveDelegate(sessionId: string): void` — consumed by Task 8 (`decideUserPromptSubmit`) and Task 9 (`startDelegate`/`replyDelegate`)

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/claude-code-session-store.test.ts`:

```ts
import { describe, it, expect } from "bun:test"
import { getActiveDelegate, setActiveDelegate, clearActiveDelegate } from "../claude-code-adapter/session-store"

describe("claude code session store", () => {
  it("returns undefined for a session with no state", () => {
    expect(getActiveDelegate("cc-session-nonexistent")).toBeUndefined()
  })

  it("sets and gets active delegate", () => {
    setActiveDelegate("cc-session-1", "codex", "thread-123")
    const result = getActiveDelegate("cc-session-1")
    expect(result?.delegate).toBe("codex")
    expect(result?.externalId).toBe("thread-123")
  })

  it("clears active delegate", () => {
    setActiveDelegate("cc-session-2", "opencode", "ses_456")
    clearActiveDelegate("cc-session-2")
    expect(getActiveDelegate("cc-session-2")).toBeUndefined()
  })

  it("supports multiple independent sessions", () => {
    setActiveDelegate("cc-session-3", "codex", "thread-a")
    setActiveDelegate("cc-session-4", "opencode", "ses_b")

    expect(getActiveDelegate("cc-session-3")?.delegate).toBe("codex")
    expect(getActiveDelegate("cc-session-4")?.delegate).toBe("opencode")
  })

  it("overwrites existing delegate for the same session", () => {
    setActiveDelegate("cc-session-5", "codex", "thread-x")
    setActiveDelegate("cc-session-5", "opencode", "ses_y")

    const result = getActiveDelegate("cc-session-5")
    expect(result?.delegate).toBe("opencode")
    expect(result?.externalId).toBe("ses_y")
  })

  it("clearing a session with no state is a safe no-op", () => {
    expect(() => clearActiveDelegate("cc-session-never-set")).not.toThrow()
    expect(getActiveDelegate("cc-session-never-set")).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/__tests__/claude-code-session-store.test.ts`
Expected: FAIL — `Cannot find module "../claude-code-adapter/session-store"`

- [ ] **Step 3: Write minimal implementation**

Create `src/claude-code-adapter/session-store.ts`:

```ts
import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"

export type DelegateSession = {
  delegate: string
  externalId: string
}

type StoredState = {
  delegate?: DelegateSession
}

const STATE_DIR = join(tmpdir(), "cli-dispatch-claude-code-adapter")

function statePath(sessionId: string): string {
  return join(STATE_DIR, `${sessionId}.json`)
}

function readState(sessionId: string): StoredState {
  const path = statePath(sessionId)
  if (!existsSync(path)) return {}
  try {
    return JSON.parse(readFileSync(path, "utf-8"))
  } catch {
    return {}
  }
}

function writeState(sessionId: string, state: StoredState): void {
  mkdirSync(STATE_DIR, { recursive: true })
  const path = statePath(sessionId)
  const tmpPath = `${path}.tmp-${process.pid}`
  writeFileSync(tmpPath, JSON.stringify(state))
  renameSync(tmpPath, path)
}

export function getActiveDelegate(sessionId: string): DelegateSession | undefined {
  return readState(sessionId).delegate
}

export function setActiveDelegate(sessionId: string, delegate: string, externalId: string): void {
  const state = readState(sessionId)
  state.delegate = { delegate, externalId }
  writeState(sessionId, state)
}

export function clearActiveDelegate(sessionId: string): void {
  const state = readState(sessionId)
  delete state.delegate
  writeState(sessionId, state)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/__tests__/claude-code-session-store.test.ts`
Expected: PASS, all 6 tests

- [ ] **Step 5: Commit**

```bash
git add src/claude-code-adapter/session-store.ts src/__tests__/claude-code-session-store.test.ts
git commit -m "feat: add file-backed session store for the claude code adapter"
```

---

### Task 7: `PreToolUse` sanitization logic

**Files:**
- Create: `src/claude-code-adapter/pretooluse-check.ts`
- Test: `src/__tests__/claude-code-pretooluse-check.test.ts`

**Interfaces:**
- Consumes: `GENERATED_MARKER` from `../commands`, `MCP_TOOL_PREFIX` from `./config` (Task 5)
- Produces: `checkPreToolUse(input: {tool_name: string; tool_input: Record<string, unknown>}, delegateNames: string[]): {block: false} | {block: true; reason: string}` — consumed by Task 10 (`pretooluse-cli.ts`)

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/claude-code-pretooluse-check.test.ts`:

```ts
import { describe, it, expect } from "bun:test"
import { checkPreToolUse } from "../claude-code-adapter/pretooluse-check"
import { GENERATED_MARKER } from "../commands"

describe("checkPreToolUse", () => {
  it("rejects a codex_start prompt containing the generated-command marker", () => {
    const verdict = checkPreToolUse(
      { tool_name: "mcp__cli-dispatch__codex_start", tool_input: { prompt: `${GENERATED_MARKER}\nDelegate this conversation.` } },
      ["codex", "opencode"],
    )
    expect(verdict.block).toBe(true)
    if (verdict.block) expect(verdict.reason).toContain("prompt")
  })

  it("rejects an opencode_reply prompt containing the marker", () => {
    const verdict = checkPreToolUse(
      { tool_name: "mcp__cli-dispatch__opencode_reply", tool_input: { prompt: `some text\n${GENERATED_MARKER}\nmore text` } },
      ["codex", "opencode"],
    )
    expect(verdict.block).toBe(true)
  })

  it("allows an ordinary user prompt through", () => {
    const verdict = checkPreToolUse(
      { tool_name: "mcp__cli-dispatch__codex_start", tool_input: { prompt: "please fix the failing test" } },
      ["codex", "opencode"],
    )
    expect(verdict.block).toBe(false)
  })

  it("ignores tools that aren't configured delegate tools", () => {
    const verdict = checkPreToolUse(
      { tool_name: "Bash", tool_input: { command: `echo ${GENERATED_MARKER}` } },
      ["codex", "opencode"],
    )
    expect(verdict.block).toBe(false)
  })

  it("ignores an unrelated mcp tool even if it contains the marker", () => {
    const verdict = checkPreToolUse(
      { tool_name: "mcp__other-server__some_tool", tool_input: { prompt: GENERATED_MARKER } },
      ["codex", "opencode"],
    )
    expect(verdict.block).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/__tests__/claude-code-pretooluse-check.test.ts`
Expected: FAIL — `Cannot find module "../claude-code-adapter/pretooluse-check"`

- [ ] **Step 3: Write minimal implementation**

Create `src/claude-code-adapter/pretooluse-check.ts`:

```ts
import { GENERATED_MARKER } from "../commands"
import { MCP_TOOL_PREFIX } from "./config"

export type PreToolUseInput = {
  tool_name: string
  tool_input: Record<string, unknown>
}

export type PreToolUseVerdict = { block: false } | { block: true; reason: string }

export function checkPreToolUse(input: PreToolUseInput, delegateNames: string[]): PreToolUseVerdict {
  const delegateToolNames = new Set(
    delegateNames.flatMap((name) => [`${MCP_TOOL_PREFIX}${name}_start`, `${MCP_TOOL_PREFIX}${name}_reply`]),
  )

  if (!delegateToolNames.has(input.tool_name)) return { block: false }

  const prompt = input.tool_input.prompt
  if (typeof prompt === "string" && prompt.includes(GENERATED_MARKER)) {
    return {
      block: true,
      reason: `${input.tool_name} rejected: the "prompt" argument contains the whole delegate command template instead of the user's actual message. Pass only the user's text as "prompt".`,
    }
  }

  return { block: false }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/__tests__/claude-code-pretooluse-check.test.ts`
Expected: PASS, all 5 tests

- [ ] **Step 5: Commit**

```bash
git add src/claude-code-adapter/pretooluse-check.ts src/__tests__/claude-code-pretooluse-check.test.ts
git commit -m "feat: add PreToolUse prompt-sanitization check for the claude code adapter"
```

---

### Task 8: `UserPromptSubmit` routing/gating logic

**Files:**
- Create: `src/claude-code-adapter/userpromptsubmit-logic.ts`
- Test: `src/__tests__/claude-code-userpromptsubmit-logic.test.ts`

**Interfaces:**
- Consumes: `getActiveDelegate`/`clearActiveDelegate` (Task 6), `getCurrentModel` (Task 4), `matchesModelPattern`, `MCP_TOOL_PREFIX`, `ClaudeCodeAdapterConfig` (Task 5), `buildRoutingRule` (Task 3, `../routing-rule`)
- Produces: `decideUserPromptSubmit(input: {session_id: string; prompt: string; transcript_path: string}, config: ClaudeCodeAdapterConfig): {kind: "none"} | {kind: "inject"; context: string} | {kind: "block"; reason: string}` — consumed by Task 10 (`userpromptsubmit-cli.ts`)

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/claude-code-userpromptsubmit-logic.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { writeFileSync, mkdtempSync, rmSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"
import { decideUserPromptSubmit } from "../claude-code-adapter/userpromptsubmit-logic"
import { setActiveDelegate, clearActiveDelegate, getActiveDelegate } from "../claude-code-adapter/session-store"
import type { ClaudeCodeAdapterConfig } from "../claude-code-adapter/config"

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "cli-dispatch-ups-test-"))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

const baseConfig: ClaudeCodeAdapterConfig = {
  delegates: {
    codex: { binary: "codex", parser: "codex", startArgs: ["{prompt}"], replyArgs: ["{externalId}", "{prompt}"] },
    opencode: { binary: "opencode", parser: "opencode", startArgs: ["{prompt}"], replyArgs: ["{externalId}", "{prompt}"] },
  },
}

function transcriptWithModel(model: string): string {
  const path = join(dir, `${Math.random()}.jsonl`)
  writeFileSync(path, `${JSON.stringify({ type: "assistant", message: { model } })}\n`)
  return path
}

function emptyTranscript(): string {
  return join(dir, "nonexistent.jsonl")
}

describe("decideUserPromptSubmit: home command", () => {
  it("clears an active delegation and blocks with a note", () => {
    setActiveDelegate("ups-session-1", "codex", "thread-1")
    const action = decideUserPromptSubmit(
      { session_id: "ups-session-1", prompt: "/cc", transcript_path: emptyTranscript() },
      baseConfig,
    )
    expect(action.kind).toBe("block")
    if (action.kind === "block") expect(action.reason).toContain("Cleared the active codex delegation")
    expect(getActiveDelegate("ups-session-1")).toBeUndefined()
  })

  it("reports no active delegation as a safe no-op", () => {
    const action = decideUserPromptSubmit(
      { session_id: "ups-session-2", prompt: "/cc", transcript_path: emptyTranscript() },
      baseConfig,
    )
    expect(action.kind).toBe("block")
    if (action.kind === "block") expect(action.reason).toContain("No CLI delegation was active")
  })

  it("recognizes /cc with trailing text", () => {
    setActiveDelegate("ups-session-3", "opencode", "ses-1")
    const action = decideUserPromptSubmit(
      { session_id: "ups-session-3", prompt: "/cc thanks", transcript_path: emptyTranscript() },
      baseConfig,
    )
    expect(action.kind).toBe("block")
    expect(getActiveDelegate("ups-session-3")).toBeUndefined()
  })
})

describe("decideUserPromptSubmit: delegate-start commands", () => {
  it("allows a delegate-start command through when no verifiedModels is configured", () => {
    const action = decideUserPromptSubmit(
      { session_id: "ups-session-4", prompt: "/codex fix the bug", transcript_path: transcriptWithModel("gpt-5") },
      baseConfig,
    )
    expect(action.kind).toBe("none")
  })

  it("allows a delegate-start command through when the model matches the allow-list", () => {
    const config: ClaudeCodeAdapterConfig = { ...baseConfig, verifiedModels: ["claude-*"] }
    const action = decideUserPromptSubmit(
      { session_id: "ups-session-5", prompt: "/codex fix the bug", transcript_path: transcriptWithModel("claude-sonnet-5") },
      config,
    )
    expect(action.kind).toBe("none")
  })

  it("blocks a delegate-start command when the model matches no allow-list entry", () => {
    const config: ClaudeCodeAdapterConfig = { ...baseConfig, verifiedModels: ["claude-*"] }
    const action = decideUserPromptSubmit(
      { session_id: "ups-session-6", prompt: "/opencode fix the bug", transcript_path: transcriptWithModel("gpt-5") },
      config,
    )
    expect(action.kind).toBe("block")
    if (action.kind === "block") {
      expect(action.reason).toContain("gpt-5")
      expect(action.reason).toContain("not on the verified-models allow-list")
    }
  })

  it("fails open when no model is known yet for the session", () => {
    const config: ClaudeCodeAdapterConfig = { ...baseConfig, verifiedModels: ["claude-*"] }
    const action = decideUserPromptSubmit(
      { session_id: "ups-session-7", prompt: "/codex fix the bug", transcript_path: emptyTranscript() },
      config,
    )
    expect(action.kind).toBe("none")
  })
})

describe("decideUserPromptSubmit: sticky follow-up", () => {
  it("injects the routing rule with the mcp-namespaced reply tool name when a delegation is active", () => {
    setActiveDelegate("ups-session-8", "codex", "thread-2")
    const action = decideUserPromptSubmit(
      { session_id: "ups-session-8", prompt: "also add a test for it", transcript_path: emptyTranscript() },
      baseConfig,
    )
    expect(action.kind).toBe("inject")
    if (action.kind === "inject") {
      expect(action.context).toContain("mcp__cli-dispatch__codex_reply")
      expect(action.context).toContain("codex CLI")
    }
  })

  it("does nothing when there's no active delegation and no recognized command", () => {
    const action = decideUserPromptSubmit(
      { session_id: "ups-session-9", prompt: "what's 2+2?", transcript_path: emptyTranscript() },
      baseConfig,
    )
    expect(action.kind).toBe("none")
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/__tests__/claude-code-userpromptsubmit-logic.test.ts`
Expected: FAIL — `Cannot find module "../claude-code-adapter/userpromptsubmit-logic"`

- [ ] **Step 3: Write minimal implementation**

Create `src/claude-code-adapter/userpromptsubmit-logic.ts`:

```ts
import { getActiveDelegate, clearActiveDelegate } from "./session-store"
import { getCurrentModel } from "./current-model"
import { matchesModelPattern, MCP_TOOL_PREFIX, type ClaudeCodeAdapterConfig } from "./config"
import { buildRoutingRule } from "../routing-rule"

export type UserPromptSubmitInput = {
  session_id: string
  prompt: string
  transcript_path: string
}

export type UserPromptSubmitAction =
  | { kind: "none" }
  | { kind: "inject"; context: string }
  | { kind: "block"; reason: string }

const HOME_COMMAND = "/cc"

function matchesCommand(prompt: string, command: string): boolean {
  return prompt === command || prompt.startsWith(`${command} `)
}

export function decideUserPromptSubmit(
  input: UserPromptSubmitInput,
  config: ClaudeCodeAdapterConfig,
): UserPromptSubmitAction {
  const prompt = input.prompt.trim()

  if (matchesCommand(prompt, HOME_COMMAND)) {
    const active = getActiveDelegate(input.session_id)
    clearActiveDelegate(input.session_id)
    const reason = active
      ? `[plugin] Cleared the active ${active.delegate} delegation for this session.`
      : "[plugin] No CLI delegation was active for this session."
    return { kind: "block", reason }
  }

  for (const name of Object.keys(config.delegates)) {
    if (!matchesCommand(prompt, `/${name}`)) continue

    const patterns = config.verifiedModels
    if (patterns && patterns.length > 0) {
      const model = getCurrentModel(input.transcript_path)
      if (model && !matchesModelPattern(model, patterns)) {
        return {
          kind: "block",
          reason: `[plugin] The current model (${model}) is not on the verified-models allow-list for CLI delegation, so ${name} was not started. Switch to a verified model and try again.`,
        }
      }
    }

    return { kind: "none" }
  }

  const active = getActiveDelegate(input.session_id)
  if (active) {
    return { kind: "inject", context: buildRoutingRule(active.delegate, `${MCP_TOOL_PREFIX}${active.delegate}_reply`) }
  }

  return { kind: "none" }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/__tests__/claude-code-userpromptsubmit-logic.test.ts`
Expected: PASS, all 9 tests

- [ ] **Step 5: Commit**

```bash
git add src/claude-code-adapter/userpromptsubmit-logic.ts src/__tests__/claude-code-userpromptsubmit-logic.test.ts
git commit -m "feat: add UserPromptSubmit routing/gating logic for the claude code adapter"
```

---

### Task 9: Delegate tool business logic

**Files:**
- Create: `src/claude-code-adapter/delegate-tools.ts`
- Test: `src/__tests__/claude-code-delegate-tools.test.ts`

**Interfaces:**
- Consumes: `runDelegate`/`RunDelegateFn` (`../run-delegate`), `resolveArgs`/`DelegateConfig` (`../config`), `setActiveDelegate` (Task 6)
- Produces: `startDelegate(name: string, cfg: DelegateConfig, prompt: string, sessionId: string, run?: RunDelegateFn): Promise<string>`, `replyDelegate(name: string, cfg: DelegateConfig, prompt: string, sessionId: string, run?: RunDelegateFn): Promise<string>` — consumed by Task 10 (`mcp-server.ts`)

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/claude-code-delegate-tools.test.ts`:

```ts
import { describe, it, expect } from "bun:test"
import { startDelegate, replyDelegate } from "../claude-code-adapter/delegate-tools"
import { getActiveDelegate, clearActiveDelegate } from "../claude-code-adapter/session-store"
import type { DelegateConfig } from "../config"

const codexConfig: DelegateConfig = {
  binary: "codex",
  parser: "codex",
  startArgs: ["exec", "--", "{prompt}"],
  replyArgs: ["exec", "resume", "{externalId}", "--", "{prompt}"],
}

describe("startDelegate", () => {
  it("runs the delegate and registers the session on success", async () => {
    clearActiveDelegate("dt-session-1")
    const fakeRun = async (options: { args: string[] }) => {
      expect(options.args).toContain("do the thing")
      return { finalText: "done", externalId: "thread-1", stderrText: "" }
    }

    const result = await startDelegate("codex", codexConfig, "do the thing", "dt-session-1", fakeRun as any)

    expect(result).toBe("done")
    expect(getActiveDelegate("dt-session-1")).toEqual({ delegate: "codex", externalId: "thread-1" })
  })

  it("returns a placeholder message when the delegate produces no text", async () => {
    clearActiveDelegate("dt-session-2")
    const fakeRun = async () => ({ finalText: "", externalId: "thread-2", stderrText: "" })

    const result = await startDelegate("codex", codexConfig, "task", "dt-session-2", fakeRun as any)

    expect(result).toBe("(codex returned no text response)")
  })

  it("surfaces a failure without registering a session", async () => {
    clearActiveDelegate("dt-session-3")
    const fakeRun = async () => {
      throw new Error("codex exited with code 1")
    }

    const result = await startDelegate("codex", codexConfig, "task", "dt-session-3", fakeRun as any)

    expect(result).toContain("codex failed")
    expect(result).toContain("codex exited with code 1")
    expect(getActiveDelegate("dt-session-3")).toBeUndefined()
  })
})

describe("replyDelegate", () => {
  it("continues the active session", async () => {
    clearActiveDelegate("dt-session-4")
    const fakeStartRun = async () => ({ finalText: "started", externalId: "thread-4", stderrText: "" })
    await startDelegate("codex", codexConfig, "start", "dt-session-4", fakeStartRun as any)

    const fakeReplyRun = async (options: { args: string[] }) => {
      expect(options.args).toContain("thread-4")
      return { finalText: "replied", externalId: undefined, stderrText: "" }
    }
    const result = await replyDelegate("codex", codexConfig, "follow up", "dt-session-4", fakeReplyRun as any)

    expect(result).toBe("replied")
  })

  it("throws when no active session exists for this delegate", async () => {
    clearActiveDelegate("dt-session-5")
    const fakeRun = async () => ({ finalText: "should not run", externalId: undefined, stderrText: "" })

    await expect(replyDelegate("codex", codexConfig, "follow up", "dt-session-5", fakeRun as any)).rejects.toThrow(
      "No active codex session",
    )
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/__tests__/claude-code-delegate-tools.test.ts`
Expected: FAIL — `Cannot find module "../claude-code-adapter/delegate-tools"`

- [ ] **Step 3: Write minimal implementation**

Create `src/claude-code-adapter/delegate-tools.ts`:

```ts
import { resolveArgs, type DelegateConfig } from "../config"
import { runDelegate, type RunDelegateFn } from "../run-delegate"
import { getActiveDelegate, setActiveDelegate } from "./session-store"

const DEFAULT_DELEGATE_TIMEOUT_MS = 10 * 60 * 1000

export async function startDelegate(
  name: string,
  cfg: DelegateConfig,
  prompt: string,
  sessionId: string,
  run: RunDelegateFn = runDelegate,
): Promise<string> {
  const externalIdSeed = crypto.randomUUID()
  const resolvedArgs = resolveArgs(cfg.startArgs, { prompt, sessionId: externalIdSeed })

  let result
  try {
    result = await run({
      binary: cfg.binary,
      args: resolvedArgs,
      parser: cfg.parser,
      onProgress: () => {},
      timeoutMs: cfg.timeoutMs ?? DEFAULT_DELEGATE_TIMEOUT_MS,
    })
  } catch (err) {
    return `${name} failed: ${err instanceof Error ? err.message : String(err)}. Use /cc to exit delegation.`
  }

  const externalId = result.externalId ?? externalIdSeed
  setActiveDelegate(sessionId, name, externalId)

  return result.finalText || `(${name} returned no text response)`
}

export async function replyDelegate(
  name: string,
  cfg: DelegateConfig,
  prompt: string,
  sessionId: string,
  run: RunDelegateFn = runDelegate,
): Promise<string> {
  const active = getActiveDelegate(sessionId)
  if (!active || active.delegate !== name) {
    throw new Error(`No active ${name} session for this conversation. Call ${name}_start first.`)
  }

  const resolvedArgs = resolveArgs(cfg.replyArgs, { prompt, externalId: active.externalId })

  let result
  try {
    result = await run({
      binary: cfg.binary,
      args: resolvedArgs,
      parser: cfg.parser,
      onProgress: () => {},
      timeoutMs: cfg.timeoutMs ?? DEFAULT_DELEGATE_TIMEOUT_MS,
    })
  } catch (err) {
    return `${name} failed: ${err instanceof Error ? err.message : String(err)}. Use /cc to exit delegation.`
  }

  return result.finalText || `(${name} returned no text response)`
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/__tests__/claude-code-delegate-tools.test.ts`
Expected: PASS, all 5 tests

- [ ] **Step 5: Commit**

```bash
git add src/claude-code-adapter/delegate-tools.ts src/__tests__/claude-code-delegate-tools.test.ts
git commit -m "feat: add delegate start/reply business logic for the claude code adapter"
```

---

### Task 10: MCP server and hook CLI wrappers

**Files:**
- Create: `src/claude-code-adapter/mcp-server.ts`
- Create: `src/claude-code-adapter/pretooluse-cli.ts`
- Create: `src/claude-code-adapter/userpromptsubmit-cli.ts`
- Modify: `package.json` (add `@modelcontextprotocol/sdk` and `zod` to `dependencies`)

**Interfaces:**
- Consumes: `startDelegate`/`replyDelegate` (Task 9), `loadAdapterConfig` (Task 5), `checkPreToolUse` (Task 7), `decideUserPromptSubmit` (Task 8)
- Produces: three executable entrypoints, consumed by Task 11's wiring (`.mcp.json`, `.claude/settings.json`)

This task is glue code (stdin/stdout/exit-code plumbing and MCP SDK wiring) rather than independently testable business logic — all the logic it calls was already TDD'd in Tasks 5–9. Verification here is a manual smoke test (Step 4) rather than `bun test`, matching how this repo's own `.opencode/plugin/cli-dispatch.ts` (the OpenCode entrypoint) isn't unit tested either — only the modules it wires together are.

- [ ] **Step 1: Add the new runtime dependencies**

In `package.json`, add a `dependencies` block (this package doesn't have one yet — `@opencode-ai/plugin` deliberately isn't a runtime dependency, per `harden-sticky-routing`'s prior fix, but `@modelcontextprotocol/sdk` and `zod` genuinely are: the MCP server process directly imports and needs them bundled):

```json
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.29.0",
    "zod": "^4.4.3"
  },
```

Insert it after `"scripts"` and before `"devDependencies"`. Run:

```bash
bun install
```

Expected: `bun.lock` updates, `node_modules/@modelcontextprotocol` and `node_modules/zod` appear.

- [ ] **Step 2: Write the MCP server**

Create `src/claude-code-adapter/mcp-server.ts`:

```ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { z } from "zod"
import { loadAdapterConfig, MCP_SERVER_NAME } from "./config"
import { startDelegate, replyDelegate } from "./delegate-tools"

const sessionId = process.env.CLAUDE_CODE_SESSION_ID
if (!sessionId) {
  console.error("[cli-dispatch] CLAUDE_CODE_SESSION_ID is not set; this server must be run as a Claude Code MCP server subprocess.")
  process.exit(1)
}

const config = loadAdapterConfig()
const server = new McpServer({ name: MCP_SERVER_NAME, version: "1.0.0" })

for (const [name, cfg] of Object.entries(config.delegates)) {
  server.registerTool(
    `${name}_start`,
    { description: `Start a new ${name} CLI session with the given task and return ${name}'s response.`, inputSchema: { prompt: z.string() } },
    async (args) => ({ content: [{ type: "text", text: await startDelegate(name, cfg, args.prompt, sessionId) }] }),
  )

  server.registerTool(
    `${name}_reply`,
    { description: `Continue the active ${name} CLI session for this conversation with a follow-up message.`, inputSchema: { prompt: z.string() } },
    async (args) => ({ content: [{ type: "text", text: await replyDelegate(name, cfg, args.prompt, sessionId) }] }),
  )
}

const transport = new StdioServerTransport()
await server.connect(transport)
```

- [ ] **Step 3: Write the hook CLI wrappers**

Create `src/claude-code-adapter/pretooluse-cli.ts`:

```ts
import { checkPreToolUse } from "./pretooluse-check"
import { loadAdapterConfig } from "./config"

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer)
  return Buffer.concat(chunks).toString("utf-8")
}

async function main() {
  const input = JSON.parse(await readStdin())
  const config = loadAdapterConfig()
  const verdict = checkPreToolUse(input, Object.keys(config.delegates))

  if (verdict.block) {
    process.stderr.write(verdict.reason + "\n")
    process.exit(2)
  }

  process.exit(0)
}

main()
```

Create `src/claude-code-adapter/userpromptsubmit-cli.ts`:

```ts
import { decideUserPromptSubmit } from "./userpromptsubmit-logic"
import { loadAdapterConfig } from "./config"

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer)
  return Buffer.concat(chunks).toString("utf-8")
}

async function main() {
  const input = JSON.parse(await readStdin())
  const config = loadAdapterConfig()
  const action = decideUserPromptSubmit(input, config)

  if (action.kind === "block") {
    process.stderr.write(action.reason + "\n")
    process.exit(2)
  }

  if (action.kind === "inject") {
    process.stdout.write(action.context + "\n")
  }

  process.exit(0)
}

main()
```

- [ ] **Step 4: Manual smoke test**

Run:

```bash
echo '{"tool_name":"Bash","tool_input":{"command":"ls"}}' | bun run src/claude-code-adapter/pretooluse-cli.ts
echo "exit code: $?"
```

Expected: no stderr output, `exit code: 0` (this requires `claude-code-adapter.config.json` to already exist at repo root — Task 11 creates it; run this smoke test after Task 11 instead if it fails with a config-not-found error here).

- [ ] **Step 5: Run the full suite and typecheck**

Run: `bun test && bun run build`
Expected: all tests still pass; `tsc` succeeds with no new type errors

- [ ] **Step 6: Commit**

```bash
git add src/claude-code-adapter/mcp-server.ts src/claude-code-adapter/pretooluse-cli.ts src/claude-code-adapter/userpromptsubmit-cli.ts package.json bun.lock
git commit -m "feat: add MCP server and hook CLI entrypoints for the claude code adapter"
```

---

### Task 11: Wiring — dogfood this repo's own Claude Code session

**Files:**
- Create: `claude-code-adapter.config.json`
- Create: `.mcp.json`
- Modify: `.claude/settings.json`
- Create: `.claude/commands/codex.md`
- Create: `.claude/commands/opencode.md`
- Create: `.claude/commands/cc.md`

**Interfaces:**
- Consumes: everything from Tasks 1–10
- Produces: a working, dogfooded installation in this repo's own `.claude/` — no further consumers

- [ ] **Step 1: Delegate config**

Create `claude-code-adapter.config.json`:

```json
{
  "delegates": {
    "codex": {
      "binary": "codex",
      "parser": "codex",
      "startArgs": ["exec", "--json", "-c", "sandbox_mode=workspace-write", "--skip-git-repo-check", "--", "{prompt}"],
      "replyArgs": ["exec", "resume", "{externalId}", "--json", "-c", "sandbox_mode=workspace-write", "--skip-git-repo-check", "--", "{prompt}"]
    },
    "opencode": {
      "binary": "opencode",
      "parser": "opencode",
      "startArgs": ["run", "--format", "json", "{prompt}"],
      "replyArgs": ["run", "--format", "json", "-s", "{externalId}", "-c", "{prompt}"]
    }
  },
  "verifiedModels": ["claude-*"]
}
```

- [ ] **Step 2: MCP server registration**

Create `.mcp.json`:

```json
{
  "mcpServers": {
    "cli-dispatch": {
      "command": "bun",
      "args": ["run", "src/claude-code-adapter/mcp-server.ts"]
    }
  }
}
```

- [ ] **Step 3: Hooks — merge into the existing settings, don't overwrite**

Read the current `.claude/settings.json` first — it currently contains only `{"permissions": {"defaultMode": "acceptEdits"}}`. Replace it with:

```json
{
    "permissions": {
      "defaultMode": "acceptEdits"
    },
    "hooks": {
      "PreToolUse": [
        {
          "matcher": "*",
          "hooks": [
            {
              "type": "command",
              "command": "bun run \"$CLAUDE_PROJECT_DIR\"/src/claude-code-adapter/pretooluse-cli.ts"
            }
          ]
        }
      ],
      "UserPromptSubmit": [
        {
          "hooks": [
            {
              "type": "command",
              "command": "bun run \"$CLAUDE_PROJECT_DIR\"/src/claude-code-adapter/userpromptsubmit-cli.ts"
            }
          ]
        }
      ]
    }
}
```

(If, by the time this task runs, `.claude/settings.json` has picked up other keys from unrelated work, merge into the existing object — add the `hooks` key alongside whatever else is there, following the same non-destructive merge `git-guardrails-claude-code`'s own setup step already established as this repo's convention for this file.)

- [ ] **Step 4: Slash commands**

Create `.claude/commands/codex.md`:

```markdown
---
description: Delegate this conversation to the codex CLI (sticky - follow-ups keep going to codex until /cc or /opencode is used)
---

Delegate this conversation to the codex CLI.

Call the `mcp__cli-dispatch__codex_start` tool with the `prompt` argument set to exactly this text, verbatim, nothing else: $ARGUMENTS

Return the tool's output to the user as your answer — do not add your own commentary on top of it unless the user asks a question about it separately.

**Exiting delegation:** run `/cc` to end the delegation and return to Claude Code, or `/opencode` to switch to the opencode delegate instead.
```

Create `.claude/commands/opencode.md`:

```markdown
---
description: Delegate this conversation to the opencode CLI (sticky - follow-ups keep going to opencode until /cc or /codex is used)
---

Delegate this conversation to the opencode CLI.

Call the `mcp__cli-dispatch__opencode_start` tool with the `prompt` argument set to exactly this text, verbatim, nothing else: $ARGUMENTS

Return the tool's output to the user as your answer — do not add your own commentary on top of it unless the user asks a question about it separately.

**Exiting delegation:** run `/cc` to end the delegation and return to Claude Code, or `/codex` to switch to the codex delegate instead.
```

Create `.claude/commands/cc.md`:

```markdown
---
description: Exit CLI delegation and return to Claude Code (sticky off)
---

The `UserPromptSubmit` hook already cleared any active CLI delegation for this session and blocked this turn before it reached you — you should never actually see this file's body executed as a model turn. It exists so `/cc` is recognized as a valid slash command by Claude Code's UI.
```

- [ ] **Step 5: Manual end-to-end smoke test**

In a fresh terminal, from the repo root:

```bash
claude -p --permission-mode bypassPermissions --output-format json "/codex reply with exactly: WIRING_SMOKE_TEST"
```

Expected: Claude Code prompts for `.mcp.json` server approval on first run (interactive only — for this headless smoke test, add `--mcp-config .mcp.json --strict-mcp-config` to bypass the approval prompt the same way this plan's earlier spikes did); the result contains `WIRING_SMOKE_TEST`, confirming the codex delegate actually ran.

- [ ] **Step 6: Commit**

```bash
git add claude-code-adapter.config.json .mcp.json .claude/settings.json .claude/commands/codex.md .claude/commands/opencode.md .claude/commands/cc.md
git commit -m "feat: wire the claude code adapter into this repo's own Claude Code session"
```

---

### Task 12: Documentation

**Files:**
- Modify: `README.md`
- Modify: `README_CN.md`

**Interfaces:**
- Consumes: nothing (documentation only)

- [ ] **Step 1: Add a "Claude Code adapter" section to README.md**

After the existing `## Usage` section's content (before `### Timeout and cancellation`), add:

```markdown
## Claude Code adapter

Alongside the OpenCode plugin, this repo also ships a Claude Code adapter (`src/claude-code-adapter/`) so Claude Code itself can delegate to `codex` and `opencode` headlessly — the same sticky-routing/verified-models/prompt-sanitization contract, reimplemented on Claude Code's own MCP server + `PreToolUse`/`UserPromptSubmit` hooks instead of OpenCode's plugin API. See `openspec/changes/archive/`'s `claude-code-host-adapter` change for the full design rationale (why an MCP server, why file-backed session state, how model discovery works without a `chat.message`-equivalent hook).

- `/codex`, `/opencode` — delegate-start commands (registered as MCP tools `codex_start`/`opencode_start` under the `cli-dispatch` MCP server).
- `/cc` — return to Claude Code, clearing any active delegation (deterministically, via the `UserPromptSubmit` hook — no model turn is spent relaying this).
- Configuration lives in `claude-code-adapter.config.json` at the repo root: the same `delegates` shape as `cli-dispatch.config.json` (see [Configuration](#configuration)), plus an adapter-specific `verifiedModels` — a bare array of model-name patterns (e.g. `["claude-*"]`), not `provider/model` pairs like the OpenCode side, since Claude Code's hooks don't expose a provider dimension.
- **One-time setup step:** the first time Claude Code loads a project-scoped `.mcp.json`, it requires interactive approval before connecting (shown as "⏸ Pending approval" until approved). This is expected, not a bug — approve it once per machine/project.
```

- [ ] **Step 2: Add the equivalent section to README_CN.md**

After the existing `## 使用方法` section's content (before `### 超时与取消`), add:

```markdown
## Claude Code 适配层

除了 OpenCode 插件之外，本仓库还提供了一个 Claude Code 适配层（`src/claude-code-adapter/`），让 Claude Code 自己也能 headless 地委托给 `codex` 和 `opencode`——同样的粘性路由/verifiedModels 白名单/prompt 模板净化机制，只是用 Claude Code 自己的 MCP server + `PreToolUse`/`UserPromptSubmit` hooks 重新实现，而不是 OpenCode 的插件 API。完整的设计推导（为什么用 MCP server、为什么用落盘的会话状态、没有 `chat.message` 等价物时怎么发现当前模型）见 `openspec/changes/archive/` 下的 `claude-code-host-adapter` 变更记录。

- `/codex`、`/opencode` —— 委托启动命令（注册为 `cli-dispatch` MCP server 下的 `codex_start`/`opencode_start` 工具）。
- `/cc` —— 回到 Claude Code，清除当前委托（由 `UserPromptSubmit` hook 确定性地完成——不会浪费一轮模型调用去转述这件事）。
- 配置位于仓库根目录的 `claude-code-adapter.config.json`：`delegates` 字段形状与 `cli-dispatch.config.json` 相同（见[配置](#配置)），另外有一个适配层专属的 `verifiedModels`——一份纯模型名字符串数组（如 `["claude-*"]`），而不是 OpenCode 那边的 `provider/model` 二段式，因为 Claude Code 的 hook 不会暴露 provider 维度。
- **一次性设置步骤：** Claude Code 第一次加载项目级 `.mcp.json` 时需要交互式批准（批准前显示为"⏸ Pending approval"）。这是预期行为，不是 bug——每台机器/每个项目批准一次即可。
```

- [ ] **Step 3: Commit**

```bash
git add README.md README_CN.md
git commit -m "docs: document the claude code adapter"
```

---

### Task 13: Final verification and archive

**Files:** none (verification only)

- [ ] **Step 1: Full test suite**

Run: `bun test`
Expected: all tests pass (OpenCode-side tests unaffected; new `claude-code-*` tests all green)

- [ ] **Step 2: Typecheck and build**

Run: `bun run build`
Expected: `tsc` succeeds, `dist/claude-code-adapter/` appears alongside the existing compiled output

- [ ] **Step 3: Live end-to-end checks (manual, in a real Claude Code session in this repo)**

- Start a codex delegation via `/codex <task>`, send a plain follow-up, confirm it continues the same codex session (not a fresh one).
- Start an opencode delegation via `/opencode <task>`, confirm the response text is correctly extracted (not raw JSON).
- Issue `/cc`, confirm the delegation is cleared and the next plain message is answered by Claude Code directly.
- Temporarily set `"verifiedModels": ["gpt-*"]` in `claude-code-adapter.config.json` (excluding whatever model the session is actually using), confirm `/codex <task>` is blocked with an explicit message instead of starting a delegation. Revert the config change afterward.

- [ ] **Step 4: Archive the OpenSpec change**

Run: `/opsx:archive claude-code-host-adapter` (or follow that skill's steps directly) once all tasks above are checked off.
