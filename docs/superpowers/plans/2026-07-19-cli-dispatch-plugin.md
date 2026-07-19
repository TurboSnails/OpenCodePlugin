# CLI Dispatch Plugin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an opencode plugin + three commands (`/codex`, `/cc`, `/kimi`) that delegate the current opencode conversation to the codex, claude, or kimi CLI's own agent loop via headless subprocess, with sticky multi-turn routing and live progress.

**Architecture:** A single opencode plugin entry file (`.opencode/plugin/cli-dispatch.ts`, auto-discovered by opencode) registers six tools (`codex_start`/`codex_reply`, `claude_start`/`claude_reply`, `kimi_start`/`kimi_reply`) built from small, independently-testable modules under `.opencode/lib/cli-dispatch/`: a pure per-opencode-session state map, pure per-CLI JSONL line parsers, pure per-CLI argv builders, and a generic subprocess runner with an injectable spawn function. Three thin prompt-template commands (`.opencode/command/{codex,cc,kimi}.md`) tell the model which tool to call and instruct it to keep routing follow-ups to the same delegate.

**Tech Stack:** TypeScript running under opencode's bundled Bun runtime (`bun test` for unit tests, `Bun.spawn` for subprocesses), `@opencode-ai/plugin`'s `tool()` API, zod (re-exported as `tool.schema`) for tool argument schemas.

## Global Constraints

- Plugin module `.opencode/plugin/cli-dispatch.ts` MUST default-export an async function `(input) => Promise<Hooks>` and register tools via the returned object's `tool` map (`{ tool: { <name>: ToolDefinition } }`). A module that only has named exports (e.g. `export const Foo = tool(...)`) fails to load with `"Plugin export is not a function"` — verified live against this exact opencode install (v1.18.3).
- `codex exec resume <id>` does **not** accept `--sandbox`/`--approval-policy` flags directly (they belong to `codex exec`'s own option set, not `resume`'s); sandbox must be set via `-c sandbox_mode=read-only` on both the initial and resume calls to get consistent, safe, non-interactive behavior — verified live (without it, a resumed session autonomously ran a shell command with no approval prompt).
- kimi's session/resume id is emitted on **stderr** (`To resume this session: kimi -r <uuid>`), not in the stdout JSON stream — verified live. `kimi --print` prompts must be passed via `--prompt "<text>"` / `-c`, not as a bare positional argument (kimi's top-level CLI parses positionals as subcommand names).
- No project-level `package.json`/`node_modules` is required for `.opencode/plugin/*.ts` to import `@opencode-ai/plugin` — opencode resolves that import itself. Verified live: a plugin file importing `@opencode-ai/plugin` loaded successfully in a scratch project directory with no `node_modules` present.
- This project (`/Users/hassan/Documents/mcpOC`) is not yet a git repository.

---

## Task 1: Repository setup

- [ ] 1.1 Initialize git and directory scaffold

Run:
```bash
cd /Users/hassan/Documents/mcpOC
git init
mkdir -p .opencode/plugin .opencode/lib/cli-dispatch .opencode/command
```

Create `.gitignore`:
```
node_modules/
*.log
```

- [ ] 1.2 Commit

```bash
git add .gitignore
git commit -m "chore: initialize repository"
```

---

## Task 2: Session store (pure, per-opencode-session delegate state)

**Files:**
- Create: `.opencode/lib/cli-dispatch/session-store.ts`
- Test: `.opencode/lib/cli-dispatch/session-store.test.ts`

**Interfaces:**
- Produces: `DelegateName = "codex" | "claude" | "kimi"`; `DelegateSession = { delegate: DelegateName; externalId: string }`; `getActiveDelegate(opencodeSessionID: string): DelegateSession | undefined`; `setActiveDelegate(opencodeSessionID: string, delegate: DelegateName, externalId: string): void`; `clearActiveDelegate(opencodeSessionID: string): void`

- [ ] **Step 1: Write the failing test**

```ts
// .opencode/lib/cli-dispatch/session-store.test.ts
import { test, expect, beforeEach } from "bun:test"
import { getActiveDelegate, setActiveDelegate, clearActiveDelegate } from "./session-store"

beforeEach(() => {
  clearActiveDelegate("session-a")
  clearActiveDelegate("session-b")
})

test("returns undefined when no delegate is active", () => {
  expect(getActiveDelegate("session-a")).toBeUndefined()
})

test("stores and retrieves the active delegate for a session", () => {
  setActiveDelegate("session-a", "codex", "thread-123")
  expect(getActiveDelegate("session-a")).toEqual({ delegate: "codex", externalId: "thread-123" })
})

test("keeps sessions independent", () => {
  setActiveDelegate("session-a", "codex", "thread-123")
  setActiveDelegate("session-b", "claude", "uuid-456")
  expect(getActiveDelegate("session-a")).toEqual({ delegate: "codex", externalId: "thread-123" })
  expect(getActiveDelegate("session-b")).toEqual({ delegate: "claude", externalId: "uuid-456" })
})

test("switching delegates on the same session overwrites the active entry", () => {
  setActiveDelegate("session-a", "codex", "thread-123")
  setActiveDelegate("session-a", "claude", "uuid-456")
  expect(getActiveDelegate("session-a")).toEqual({ delegate: "claude", externalId: "uuid-456" })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test .opencode/lib/cli-dispatch/session-store.test.ts`
Expected: FAIL with a module-not-found error for `./session-store`

- [ ] **Step 3: Write minimal implementation**

```ts
// .opencode/lib/cli-dispatch/session-store.ts
export type DelegateName = "codex" | "claude" | "kimi"

export type DelegateSession = {
  delegate: DelegateName
  externalId: string
}

const sessions = new Map<string, DelegateSession>()

export function getActiveDelegate(opencodeSessionID: string): DelegateSession | undefined {
  return sessions.get(opencodeSessionID)
}

export function setActiveDelegate(
  opencodeSessionID: string,
  delegate: DelegateName,
  externalId: string,
): void {
  sessions.set(opencodeSessionID, { delegate, externalId })
}

export function clearActiveDelegate(opencodeSessionID: string): void {
  sessions.delete(opencodeSessionID)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test .opencode/lib/cli-dispatch/session-store.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add .opencode/lib/cli-dispatch/session-store.ts .opencode/lib/cli-dispatch/session-store.test.ts
git commit -m "feat: add per-session delegate state store"
```

---

## Task 3: JSONL line parsers (pure, per-CLI)

**Files:**
- Create: `.opencode/lib/cli-dispatch/parse-events.ts`
- Test: `.opencode/lib/cli-dispatch/parse-events.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks
- Produces: `ParsedLine = { progressText?: string; finalText?: string; externalId?: string }`; `parseCodexLine(line: string): ParsedLine`; `parseClaudeLine(line: string): ParsedLine`; `parseKimiLine(line: string): ParsedLine`; `parseKimiStderrForSessionId(stderrText: string): string | undefined`

These fixtures are real captured output, not guesses:
- codex `codex exec --json "Reply with exactly: PONG. Do not run any commands."` produced: `{"type":"thread.started","thread_id":"019f7a1b-3d47-7551-87fb-db4e5abc58d6"}` / `{"type":"turn.started"}` / `{"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"PONG"}}` / `{"type":"turn.completed","usage":{...}}`. A resumed run also emitted `{"type":"item.started","item":{"id":"item_1","type":"command_execution","command":"...","status":"in_progress"}}`.
- claude `claude -p --output-format stream-json --verbose --session-id <uuid> "..."` produced (among `system` bookkeeping events) `{"type":"assistant","message":{"content":[{"type":"text","text":"PONG"}]}, ...}` and a terminal `{"type":"result","subtype":"success","is_error":false,"result":"PONG", ...}`.
- kimi `kimi --print --output-format stream-json --prompt "..."` produced one stdout line: `{"role":"assistant","content":[{"type":"think","think":"..."},{"type":"text","text":"PONG"}]}`, and on stderr: `To resume this session: kimi -r bb924c56-e36d-4f21-a357-e6577bd8d58a`.

- [ ] **Step 1: Write the failing test**

```ts
// .opencode/lib/cli-dispatch/parse-events.test.ts
import { test, expect } from "bun:test"
import {
  parseCodexLine,
  parseClaudeLine,
  parseKimiLine,
  parseKimiStderrForSessionId,
} from "./parse-events"

test("codex: thread.started extracts externalId", () => {
  const line = '{"type":"thread.started","thread_id":"019f7a1b-3d47-7551-87fb-db4e5abc58d6"}'
  expect(parseCodexLine(line).externalId).toBe("019f7a1b-3d47-7551-87fb-db4e5abc58d6")
})

test("codex: item.completed agent_message extracts finalText", () => {
  const line = '{"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"PONG"}}'
  const parsed = parseCodexLine(line)
  expect(parsed.finalText).toBe("PONG")
  expect(parsed.progressText).toBe("PONG")
})

test("codex: item.started command_execution produces progress text only", () => {
  const line =
    '{"type":"item.started","item":{"id":"item_1","type":"command_execution","command":"ls -la","status":"in_progress"}}'
  const parsed = parseCodexLine(line)
  expect(parsed.progressText).toContain("ls -la")
  expect(parsed.finalText).toBeUndefined()
})

test("codex: turn.started produces no progress or final text", () => {
  expect(parseCodexLine('{"type":"turn.started"}')).toEqual({})
})

test("codex: malformed line falls back to raw progress text", () => {
  expect(parseCodexLine("not json")).toEqual({ progressText: "not json" })
})

test("claude: assistant event with text content produces progress text", () => {
  const line = JSON.stringify({
    type: "assistant",
    message: { content: [{ type: "text", text: "PONG" }] },
  })
  const parsed = parseClaudeLine(line)
  expect(parsed.progressText).toBe("PONG")
  expect(parsed.finalText).toBeUndefined()
})

test("claude: result event extracts finalText", () => {
  const line = JSON.stringify({ type: "result", subtype: "success", is_error: false, result: "PONG" })
  expect(parseClaudeLine(line).finalText).toBe("PONG")
})

test("claude: system event produces no text", () => {
  const line = JSON.stringify({ type: "system", subtype: "init" })
  expect(parseClaudeLine(line)).toEqual({})
})

test("kimi: assistant line extracts finalText from text content, ignoring think blocks", () => {
  const line =
    '{"role":"assistant","content":[{"type":"think","think":"reasoning here"},{"type":"text","text":"PONG"}]}'
  const parsed = parseKimiLine(line)
  expect(parsed.finalText).toBe("PONG")
})

test("kimi: think-only line (no text yet) surfaces think content as progress, no finalText", () => {
  const line = '{"role":"assistant","content":[{"type":"think","think":"still thinking"}]}'
  const parsed = parseKimiLine(line)
  expect(parsed.finalText).toBeUndefined()
  expect(parsed.progressText).toBe("still thinking")
})

test("kimi: session id parsed from stderr resume hint", () => {
  const stderr = "\nTo resume this session: kimi -r bb924c56-e36d-4f21-a357-e6577bd8d58a\n"
  expect(parseKimiStderrForSessionId(stderr)).toBe("bb924c56-e36d-4f21-a357-e6577bd8d58a")
})

test("kimi: stderr with no resume hint returns undefined", () => {
  expect(parseKimiStderrForSessionId("some other output\n")).toBeUndefined()
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test .opencode/lib/cli-dispatch/parse-events.test.ts`
Expected: FAIL with a module-not-found error for `./parse-events`

- [ ] **Step 3: Write minimal implementation**

```ts
// .opencode/lib/cli-dispatch/parse-events.ts
export type ParsedLine = {
  progressText?: string
  finalText?: string
  externalId?: string
}

export function parseCodexLine(line: string): ParsedLine {
  let obj: any
  try {
    obj = JSON.parse(line)
  } catch {
    return { progressText: line }
  }

  if (obj.type === "thread.started") {
    return { externalId: obj.thread_id }
  }
  if (obj.type === "item.started" && obj.item?.type === "command_execution") {
    return { progressText: `running: ${obj.item.command}` }
  }
  if (obj.type === "item.completed" && obj.item?.type === "command_execution") {
    return { progressText: `finished: ${obj.item.command}` }
  }
  if (obj.type === "item.completed" && obj.item?.type === "agent_message") {
    return { finalText: obj.item.text, progressText: obj.item.text }
  }
  return {}
}

export function parseClaudeLine(line: string): ParsedLine {
  let obj: any
  try {
    obj = JSON.parse(line)
  } catch {
    return { progressText: line }
  }

  if (obj.type === "assistant") {
    const text = (obj.message?.content ?? [])
      .filter((c: any) => c.type === "text")
      .map((c: any) => c.text)
      .join("")
    return text ? { progressText: text } : {}
  }
  if (obj.type === "result") {
    return { finalText: obj.result }
  }
  return {}
}

export function parseKimiLine(line: string): ParsedLine {
  let obj: any
  try {
    obj = JSON.parse(line)
  } catch {
    return { progressText: line }
  }

  if (obj.role === "assistant" && Array.isArray(obj.content)) {
    const text = obj.content
      .filter((c: any) => c.type === "text")
      .map((c: any) => c.text)
      .join("")
    const think = obj.content
      .filter((c: any) => c.type === "think")
      .map((c: any) => c.think)
      .join("")
    return {
      finalText: text || undefined,
      progressText: text || think || undefined,
    }
  }
  return {}
}

const KIMI_RESUME_HINT = /To resume this session: kimi -r ([0-9a-fA-F-]+)/

export function parseKimiStderrForSessionId(stderrText: string): string | undefined {
  return KIMI_RESUME_HINT.exec(stderrText)?.[1]
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test .opencode/lib/cli-dispatch/parse-events.test.ts`
Expected: PASS (11 tests)

- [ ] **Step 5: Commit**

```bash
git add .opencode/lib/cli-dispatch/parse-events.ts .opencode/lib/cli-dispatch/parse-events.test.ts
git commit -m "feat: add per-CLI JSONL line parsers"
```

---

## Task 4: Delegate argv builders (pure, per-CLI)

**Files:**
- Create: `.opencode/lib/cli-dispatch/delegates.ts`
- Test: `.opencode/lib/cli-dispatch/delegates.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks
- Produces: `DELEGATE_BINARIES: Record<"codex" | "claude" | "kimi", string>`; `buildCodexStartArgs(prompt: string): string[]`; `buildCodexReplyArgs(threadId: string, prompt: string): string[]`; `buildClaudeStartArgs(sessionId: string, prompt: string): string[]`; `buildClaudeReplyArgs(sessionId: string, prompt: string): string[]`; `buildKimiStartArgs(prompt: string): string[]`; `buildKimiReplyArgs(sessionId: string, prompt: string): string[]`

- [ ] **Step 1: Write the failing test**

```ts
// .opencode/lib/cli-dispatch/delegates.test.ts
import { test, expect } from "bun:test"
import {
  buildCodexStartArgs,
  buildCodexReplyArgs,
  buildClaudeStartArgs,
  buildClaudeReplyArgs,
  buildKimiStartArgs,
  buildKimiReplyArgs,
} from "./delegates"

test("codex start args", () => {
  expect(buildCodexStartArgs("hi")).toEqual([
    "exec",
    "--json",
    "-c",
    "sandbox_mode=read-only",
    "--skip-git-repo-check",
    "hi",
  ])
})

test("codex reply args", () => {
  expect(buildCodexReplyArgs("thread-1", "hi")).toEqual([
    "exec",
    "resume",
    "thread-1",
    "--json",
    "-c",
    "sandbox_mode=read-only",
    "--skip-git-repo-check",
    "hi",
  ])
})

test("claude start args", () => {
  expect(buildClaudeStartArgs("uuid-1", "hi")).toEqual([
    "-p",
    "--output-format",
    "stream-json",
    "--verbose",
    "--permission-mode",
    "dontAsk",
    "--session-id",
    "uuid-1",
    "hi",
  ])
})

test("claude reply args", () => {
  expect(buildClaudeReplyArgs("uuid-1", "hi")).toEqual([
    "-p",
    "--output-format",
    "stream-json",
    "--verbose",
    "--permission-mode",
    "dontAsk",
    "--resume",
    "uuid-1",
    "hi",
  ])
})

test("kimi start args", () => {
  expect(buildKimiStartArgs("hi")).toEqual(["--print", "--output-format", "stream-json", "--prompt", "hi"])
})

test("kimi reply args", () => {
  expect(buildKimiReplyArgs("sess-1", "hi")).toEqual([
    "--print",
    "--output-format",
    "stream-json",
    "-r",
    "sess-1",
    "--prompt",
    "hi",
  ])
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test .opencode/lib/cli-dispatch/delegates.test.ts`
Expected: FAIL with a module-not-found error for `./delegates`

- [ ] **Step 3: Write minimal implementation**

```ts
// .opencode/lib/cli-dispatch/delegates.ts
export const DELEGATE_BINARIES = {
  codex: "codex",
  claude: "claude",
  kimi: "kimi",
} as const

export function buildCodexStartArgs(prompt: string): string[] {
  return ["exec", "--json", "-c", "sandbox_mode=read-only", "--skip-git-repo-check", prompt]
}

export function buildCodexReplyArgs(threadId: string, prompt: string): string[] {
  return ["exec", "resume", threadId, "--json", "-c", "sandbox_mode=read-only", "--skip-git-repo-check", prompt]
}

export function buildClaudeStartArgs(sessionId: string, prompt: string): string[] {
  return [
    "-p",
    "--output-format",
    "stream-json",
    "--verbose",
    "--permission-mode",
    "dontAsk",
    "--session-id",
    sessionId,
    prompt,
  ]
}

export function buildClaudeReplyArgs(sessionId: string, prompt: string): string[] {
  return [
    "-p",
    "--output-format",
    "stream-json",
    "--verbose",
    "--permission-mode",
    "dontAsk",
    "--resume",
    sessionId,
    prompt,
  ]
}

export function buildKimiStartArgs(prompt: string): string[] {
  return ["--print", "--output-format", "stream-json", "--prompt", prompt]
}

export function buildKimiReplyArgs(sessionId: string, prompt: string): string[] {
  return ["--print", "--output-format", "stream-json", "-r", sessionId, "--prompt", prompt]
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test .opencode/lib/cli-dispatch/delegates.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add .opencode/lib/cli-dispatch/delegates.ts .opencode/lib/cli-dispatch/delegates.test.ts
git commit -m "feat: add per-CLI argv builders"
```

---

## Task 5: Subprocess runner (streams a delegate CLI, injectable spawn for tests)

**Files:**
- Create: `.opencode/lib/cli-dispatch/run-delegate.ts`
- Test: `.opencode/lib/cli-dispatch/run-delegate.test.ts`

**Interfaces:**
- Consumes: `ParsedLine` type from `./parse-events` (Task 3)
- Produces: `SpawnFn = (binary: string, args: string[]) => { stdout: ReadableStream<Uint8Array>; stderr: ReadableStream<Uint8Array>; exited: Promise<number> }`; `defaultSpawn: SpawnFn`; `runDelegate(options: { binary: string; args: string[]; parseLine: (line: string) => ParsedLine; onProgress: (text: string) => void; spawn?: SpawnFn }): Promise<{ finalText: string; externalId?: string; stderrText: string }>`

- [ ] **Step 1: Write the failing test**

```ts
// .opencode/lib/cli-dispatch/run-delegate.test.ts
import { test, expect } from "bun:test"
import { runDelegate, type SpawnFn } from "./run-delegate"
import { parseCodexLine } from "./parse-events"

function fakeSpawn(stdoutLines: string[], stderrLines: string[] = [], exitCode = 0): SpawnFn {
  return () => ({
    stdout: new Response(stdoutLines.map((l) => l + "\n").join("")).body!,
    stderr: new Response(stderrLines.map((l) => l + "\n").join("")).body!,
    exited: Promise.resolve(exitCode),
  })
}

test("collects final text and external id from streamed lines, forwards progress", async () => {
  const lines = [
    '{"type":"thread.started","thread_id":"thread-abc"}',
    '{"type":"turn.started"}',
    '{"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"PONG"}}',
    '{"type":"turn.completed","usage":{}}',
  ]
  const progressUpdates: string[] = []
  const result = await runDelegate({
    binary: "codex",
    args: [],
    parseLine: parseCodexLine,
    onProgress: (text) => progressUpdates.push(text),
    spawn: fakeSpawn(lines),
  })
  expect(result.finalText).toBe("PONG")
  expect(result.externalId).toBe("thread-abc")
  expect(progressUpdates).toContain("PONG")
})

test("keeps the last finalText when multiple agent_message events are seen", async () => {
  const lines = [
    '{"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"interim"}}',
    '{"type":"item.completed","item":{"id":"item_1","type":"agent_message","text":"final"}}',
  ]
  const result = await runDelegate({
    binary: "codex",
    args: [],
    parseLine: parseCodexLine,
    onProgress: () => {},
    spawn: fakeSpawn(lines),
  })
  expect(result.finalText).toBe("final")
})

test("captures stderr text alongside stdout", async () => {
  const result = await runDelegate({
    binary: "kimi",
    args: [],
    parseLine: parseCodexLine,
    onProgress: () => {},
    spawn: fakeSpawn(['{"type":"turn.started"}'], ["To resume this session: kimi -r abc-123"]),
  })
  expect(result.stderrText).toContain("kimi -r abc-123")
})

test("throws with stderr content when process exits non-zero and produced no text", async () => {
  await expect(
    runDelegate({
      binary: "codex",
      args: [],
      parseLine: parseCodexLine,
      onProgress: () => {},
      spawn: fakeSpawn([], ["error: not logged in"], 1),
    }),
  ).rejects.toThrow(/not logged in/)
})

test("does not throw on non-zero exit if final text was already produced", async () => {
  const result = await runDelegate({
    binary: "codex",
    args: [],
    parseLine: parseCodexLine,
    onProgress: () => {},
    spawn: fakeSpawn(
      ['{"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"PONG"}}'],
      [],
      1,
    ),
  })
  expect(result.finalText).toBe("PONG")
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test .opencode/lib/cli-dispatch/run-delegate.test.ts`
Expected: FAIL with a module-not-found error for `./run-delegate`

- [ ] **Step 3: Write minimal implementation**

```ts
// .opencode/lib/cli-dispatch/run-delegate.ts
import type { ParsedLine } from "./parse-events"

export type SpawnFn = (
  binary: string,
  args: string[],
) => {
  stdout: ReadableStream<Uint8Array>
  stderr: ReadableStream<Uint8Array>
  exited: Promise<number>
}

export type RunDelegateResult = {
  finalText: string
  externalId?: string
  stderrText: string
}

async function* readLines(stream: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let newlineIndex: number
      while ((newlineIndex = buffer.indexOf("\n")) >= 0) {
        yield buffer.slice(0, newlineIndex)
        buffer = buffer.slice(newlineIndex + 1)
      }
    }
    if (buffer.length > 0) yield buffer
  } finally {
    reader.releaseLock()
  }
}

export const defaultSpawn: SpawnFn = (binary, args) => {
  const proc = Bun.spawn([binary, ...args], { stdout: "pipe", stderr: "pipe" })
  return { stdout: proc.stdout, stderr: proc.stderr, exited: proc.exited }
}

export async function runDelegate(options: {
  binary: string
  args: string[]
  parseLine: (line: string) => ParsedLine
  onProgress: (text: string) => void
  spawn?: SpawnFn
}): Promise<RunDelegateResult> {
  const spawn = options.spawn ?? defaultSpawn
  const child = spawn(options.binary, options.args)

  let finalText = ""
  let externalId: string | undefined
  let stderrText = ""

  const stdoutTask = (async () => {
    for await (const line of readLines(child.stdout)) {
      if (!line.trim()) continue
      const parsed = options.parseLine(line)
      if (parsed.externalId) externalId = parsed.externalId
      if (parsed.finalText !== undefined) finalText = parsed.finalText
      if (parsed.progressText) options.onProgress(parsed.progressText)
    }
  })()

  const stderrTask = (async () => {
    for await (const line of readLines(child.stderr)) {
      stderrText += line + "\n"
    }
  })()

  const exitCode = await child.exited
  await Promise.all([stdoutTask, stderrTask])

  if (exitCode !== 0 && !finalText) {
    throw new Error(`${options.binary} exited with code ${exitCode}: ${stderrText.slice(0, 2000)}`)
  }

  return { finalText, externalId, stderrText }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test .opencode/lib/cli-dispatch/run-delegate.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add .opencode/lib/cli-dispatch/run-delegate.ts .opencode/lib/cli-dispatch/run-delegate.test.ts
git commit -m "feat: add streaming subprocess runner for delegate CLIs"
```

---

## Task 6: Plugin entry: register the six tools

**Files:**
- Create: `.opencode/plugin/cli-dispatch.ts`

**Interfaces:**
- Consumes: `getActiveDelegate`, `setActiveDelegate` from `../lib/cli-dispatch/session-store` (Task 2); `parseCodexLine`, `parseClaudeLine`, `parseKimiLine`, `parseKimiStderrForSessionId` from `../lib/cli-dispatch/parse-events` (Task 3); `buildCodexStartArgs`, `buildCodexReplyArgs`, `buildClaudeStartArgs`, `buildClaudeReplyArgs`, `buildKimiStartArgs`, `buildKimiReplyArgs` from `../lib/cli-dispatch/delegates` (Task 4); `runDelegate` from `../lib/cli-dispatch/run-delegate` (Task 5)
- Produces: default-exported opencode `Plugin` registering tools `codex_start`, `codex_reply`, `claude_start`, `claude_reply`, `kimi_start`, `kimi_reply` — each taking `{ prompt: string }` and returning a string

This task has no automated test (it's the integration point with opencode's plugin loader, which is verified by actually loading it — see Step 2). Write the file directly.

- [ ] **Step 1: Write the plugin entry file**

```ts
// .opencode/plugin/cli-dispatch.ts
import type { Plugin } from "@opencode-ai/plugin"
import { tool } from "@opencode-ai/plugin"
import { getActiveDelegate, setActiveDelegate } from "../lib/cli-dispatch/session-store"
import {
  parseCodexLine,
  parseClaudeLine,
  parseKimiLine,
  parseKimiStderrForSessionId,
} from "../lib/cli-dispatch/parse-events"
import {
  buildCodexStartArgs,
  buildCodexReplyArgs,
  buildClaudeStartArgs,
  buildClaudeReplyArgs,
  buildKimiStartArgs,
  buildKimiReplyArgs,
} from "../lib/cli-dispatch/delegates"
import { runDelegate } from "../lib/cli-dispatch/run-delegate"

const CliDispatchPlugin: Plugin = async () => {
  return {
    tool: {
      codex_start: tool({
        description:
          "Start a new codex CLI session with the given task and return codex's response. Use this the first time a conversation is delegated to codex.",
        args: { prompt: tool.schema.string() },
        async execute(args, context) {
          const result = await runDelegate({
            binary: "codex",
            args: buildCodexStartArgs(args.prompt),
            parseLine: parseCodexLine,
            onProgress: (text) => context.metadata({ title: "codex", metadata: { progress: text } }),
          })
          if (result.externalId) setActiveDelegate(context.sessionID, "codex", result.externalId)
          return result.finalText || "(codex returned no text response)"
        },
      }),
      codex_reply: tool({
        description:
          "Continue the active codex CLI session for this conversation with a follow-up message. Requires codex_start to have been called first.",
        args: { prompt: tool.schema.string() },
        async execute(args, context) {
          const active = getActiveDelegate(context.sessionID)
          if (!active || active.delegate !== "codex") {
            throw new Error("No active codex session for this conversation. Call codex_start first.")
          }
          const result = await runDelegate({
            binary: "codex",
            args: buildCodexReplyArgs(active.externalId, args.prompt),
            parseLine: parseCodexLine,
            onProgress: (text) => context.metadata({ title: "codex", metadata: { progress: text } }),
          })
          return result.finalText || "(codex returned no text response)"
        },
      }),
      claude_start: tool({
        description:
          "Start a new claude (Claude Code) CLI session with the given task and return its response. Use this the first time a conversation is delegated to claude.",
        args: { prompt: tool.schema.string() },
        async execute(args, context) {
          const sessionId = crypto.randomUUID()
          const result = await runDelegate({
            binary: "claude",
            args: buildClaudeStartArgs(sessionId, args.prompt),
            parseLine: parseClaudeLine,
            onProgress: (text) => context.metadata({ title: "claude", metadata: { progress: text } }),
          })
          setActiveDelegate(context.sessionID, "claude", sessionId)
          return result.finalText || "(claude returned no text response)"
        },
      }),
      claude_reply: tool({
        description:
          "Continue the active claude CLI session for this conversation with a follow-up message. Requires claude_start to have been called first.",
        args: { prompt: tool.schema.string() },
        async execute(args, context) {
          const active = getActiveDelegate(context.sessionID)
          if (!active || active.delegate !== "claude") {
            throw new Error("No active claude session for this conversation. Call claude_start first.")
          }
          const result = await runDelegate({
            binary: "claude",
            args: buildClaudeReplyArgs(active.externalId, args.prompt),
            parseLine: parseClaudeLine,
            onProgress: (text) => context.metadata({ title: "claude", metadata: { progress: text } }),
          })
          return result.finalText || "(claude returned no text response)"
        },
      }),
      kimi_start: tool({
        description:
          "Start a new kimi CLI session with the given task and return its response. Use this the first time a conversation is delegated to kimi.",
        args: { prompt: tool.schema.string() },
        async execute(args, context) {
          const result = await runDelegate({
            binary: "kimi",
            args: buildKimiStartArgs(args.prompt),
            parseLine: parseKimiLine,
            onProgress: (text) => context.metadata({ title: "kimi", metadata: { progress: text } }),
          })
          const sessionId = parseKimiStderrForSessionId(result.stderrText)
          if (sessionId) setActiveDelegate(context.sessionID, "kimi", sessionId)
          return result.finalText || "(kimi returned no text response)"
        },
      }),
      kimi_reply: tool({
        description:
          "Continue the active kimi CLI session for this conversation with a follow-up message. Requires kimi_start to have been called first.",
        args: { prompt: tool.schema.string() },
        async execute(args, context) {
          const active = getActiveDelegate(context.sessionID)
          if (!active || active.delegate !== "kimi") {
            throw new Error("No active kimi session for this conversation. Call kimi_start first.")
          }
          const result = await runDelegate({
            binary: "kimi",
            args: buildKimiReplyArgs(active.externalId, args.prompt),
            parseLine: parseKimiLine,
            onProgress: (text) => context.metadata({ title: "kimi", metadata: { progress: text } }),
          })
          return result.finalText || "(kimi returned no text response)"
        },
      }),
    },
  }
}

export default CliDispatchPlugin
```

- [ ] **Step 2: Verify the plugin loads in opencode (this is the test for this task)**

Run:
```bash
cd /Users/hassan/Documents/mcpOC
opencode run "say hi" > /tmp/oc-run-out.txt 2>&1 &
sleep 8
kill %1 2>/dev/null
LOGFILE=$(ls -t ~/.local/share/opencode/log/*.log | head -1)
grep "cli-dispatch.ts" "$LOGFILE" | tail -5
```
Expected: no line containing `failed to load plugin` for `cli-dispatch.ts`. (If one appears, the error message names the problem — e.g. a typo'd import path or a syntax error — fix it and re-run.)

- [ ] **Step 3: Commit**

```bash
git add .opencode/plugin/cli-dispatch.ts
git commit -m "feat: register codex/claude/kimi delegate tools as an opencode plugin"
```

---

## Task 7: Command routing (/codex, /cc, /kimi)

**Files:**
- Create: `.opencode/command/codex.md`
- Create: `.opencode/command/cc.md`
- Create: `.opencode/command/kimi.md`

**Interfaces:**
- Consumes: tool names `codex_start`/`codex_reply`, `claude_start`/`claude_reply`, `kimi_start`/`kimi_reply` registered in Task 6 (these files reference the tools by name in plain-language instructions, not by import — opencode commands are prompt templates, not code)

- [ ] **Step 1: Create `.opencode/command/codex.md`**

```markdown
---
description: Delegate this conversation to the codex CLI (sticky - follow-ups keep going to codex until another /codex, /cc, or /kimi command is used)
---

Delegate this conversation to the codex CLI.

**Right now:** if no codex session is active yet for this conversation, call the `codex_start` tool with the user's message (the text after `/codex`, or the whole message if `/codex` was sent alone) as the `prompt` argument. If a codex session is already active, call `codex_reply` instead. Return the tool's response to the user as your answer — do not add your own commentary on top of it unless the user asks a question about it separately.

**For every message after this one** — until the user runs `/codex`, `/cc`, or `/kimi` again — do not answer directly and do not reason about the request yourself. Instead call `codex_reply` with the user's new message as the `prompt` argument, and return its response. This applies even when the message has no command prefix.

If `codex_reply` fails because no codex session is active (e.g. it was never started, or opencode restarted since), call `codex_start` instead and continue from there.
```

- [ ] **Step 2: Create `.opencode/command/cc.md`**

```markdown
---
description: Delegate this conversation to the claude (Claude Code) CLI (sticky - follow-ups keep going to claude until another /codex, /cc, or /kimi command is used)
---

Delegate this conversation to the claude CLI (Claude Code).

**Right now:** if no claude session is active yet for this conversation, call the `claude_start` tool with the user's message (the text after `/cc`, or the whole message if `/cc` was sent alone) as the `prompt` argument. If a claude session is already active, call `claude_reply` instead. Return the tool's response to the user as your answer — do not add your own commentary on top of it unless the user asks a question about it separately.

**For every message after this one** — until the user runs `/codex`, `/cc`, or `/kimi` again — do not answer directly and do not reason about the request yourself. Instead call `claude_reply` with the user's new message as the `prompt` argument, and return its response. This applies even when the message has no command prefix.

If `claude_reply` fails because no claude session is active (e.g. it was never started, or opencode restarted since), call `claude_start` instead and continue from there.
```

- [ ] **Step 3: Create `.opencode/command/kimi.md`**

```markdown
---
description: Delegate this conversation to the kimi CLI (sticky - follow-ups keep going to kimi until another /codex, /cc, or /kimi command is used)
---

Delegate this conversation to the kimi CLI.

**Right now:** if no kimi session is active yet for this conversation, call the `kimi_start` tool with the user's message (the text after `/kimi`, or the whole message if `/kimi` was sent alone) as the `prompt` argument. If a kimi session is already active, call `kimi_reply` instead. Return the tool's response to the user as your answer — do not add your own commentary on top of it unless the user asks a question about it separately.

**For every message after this one** — until the user runs `/codex`, `/cc`, or `/kimi` again — do not answer directly and do not reason about the request yourself. Instead call `kimi_reply` with the user's new message as the `prompt` argument, and return its response. This applies even when the message has no command prefix.

If `kimi_reply` fails because no kimi session is active (e.g. it was never started, or opencode restarted since), call `kimi_start` instead and continue from there.
```

- [ ] **Step 4: Commit**

```bash
git add .opencode/command/codex.md .opencode/command/cc.md .opencode/command/kimi.md
git commit -m "feat: add /codex, /cc, /kimi delegation commands"
```

---

## Task 8: Manual end-to-end verification

No new files. This task exercises the whole system together, which the unit tests in Tasks 2-5 deliberately don't cover (they test pure logic with fakes, not real subprocesses).

- [ ] 8.1 In a real opencode session in this project (`opencode` from `/Users/hassan/Documents/mcpOC`), send `/codex say hello and tell me the current date` and confirm: a response comes back from codex, and progress metadata was visible while it ran (check opencode's tool-call UI, not just the final text)
- [ ] 8.2 Send a follow-up message with no command prefix, e.g. `what did you just tell me the date was?`, and confirm the response reflects the prior turn's context (proves `codex_reply` continued the same thread rather than starting fresh)
- [ ] 8.3 Send `/cc summarize what codex just told you` mid-conversation and confirm claude takes over — subsequent un-prefixed messages should now route to claude, not codex
- [ ] 8.4 Repeat 8.1-8.2 for `/kimi`
- [ ] 8.5 Open a second, separate opencode session (new terminal / new `opencode` invocation) in the same project, delegate it to codex with `/codex say a random word`, and confirm its thread is independent of the first session's (ask each session what the other one's random word was — neither should know)
- [ ] 8.6 Trigger a claude prompt that would normally ask for tool-use permission (e.g. `/cc create a file called scratch.txt with the word test in it` if no active session, or via `claude_reply`) and observe what `--permission-mode dontAsk` actually does in practice (auto-denies vs. hangs vs. auto-allows) — note the actual behavior; if it hangs, that's a bug to fix by revisiting the `--permission-mode` value in `buildClaudeStartArgs`/`buildClaudeReplyArgs` (Task 4)
- [ ] 8.7 If 8.6 revealed a hang or unwanted behavior, fix the flag choice in `.opencode/lib/cli-dispatch/delegates.ts`, update the corresponding tests in `delegates.test.ts`, re-run `bun test .opencode/lib/cli-dispatch/delegates.test.ts`, and commit:
```bash
git add .opencode/lib/cli-dispatch/delegates.ts .opencode/lib/cli-dispatch/delegates.test.ts
git commit -m "fix: adjust claude permission-mode default based on manual verification"
```

---

## Self-Review Notes

**Spec coverage** (against `openspec/changes/cli-dispatch-plugin/specs/cli-dispatch/spec.md`):
- "Delegate a conversation to an external CLI" → Tasks 6-7 (tools + commands for all three CLIs)
- "Sticky multi-turn delegation" → Task 7 (command instructions) + Task 6 (`*_reply` tools reading from the session store)
- "Live progress while a delegate is running" → Task 5 (`onProgress` callback) + Task 6 (`context.metadata()` wiring)
- "Session state scoped per opencode session" → Task 2 (session store keyed by `context.sessionID`) + Task 8.5 (manual proof)

**Placeholder scan:** none — every code step above is complete, runnable code; the only forward-looking items (Task 8.6-8.7) are explicit manual-verification-and-fix steps, not vague TODOs.

**Type consistency:** `DelegateName`/`DelegateSession` (Task 2) are consumed as-is in Task 6; `ParsedLine` (Task 3) is consumed as-is in Task 5's `parseLine` parameter and Task 6's `parseLine` arguments; `SpawnFn` (Task 5) matches the `defaultSpawn` implementation's return shape.
