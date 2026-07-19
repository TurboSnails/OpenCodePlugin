# Sticky CLI Delegation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `/cc`/`/codex` delegation survive intervening commands (including `/opsx-explore` and `@explore` mentions) and add a deterministic `/opencode` exit, all at the opencode plugin layer.

**Architecture:** Three new plugin hooks — `experimental.chat.system.transform` injects a routing rule into the system prompt on every turn while a delegation is active; `chat.message` rewrites agent-mention boilerplate to plain-language intent before forwarding; `command.execute.before` clears delegation state deterministically for `/opencode`. Existing delegate tools (`claude_start`/`claude_reply`/`codex_start`/`codex_reply`) and the in-memory session store are unchanged except for an exit hint added to failure strings.

**Tech Stack:** TypeScript, opencode plugin API 1.18.3, Bun test runner (`bun test`), no new dependencies.

**Spec:** `openspec/changes/sticky-cli-delegation/` (proposal.md, design.md, specs/cli-dispatch/spec.md, tasks.md) — commit `2b22de8`.

## Global Constraints

- opencode version **1.18.3**; hook names verbatim: `"experimental.chat.system.transform"`, `"chat.message"`, `"command.execute.before"`.
- No new npm dependencies. Tests use `bun:test` and live next to source as `*.test.ts` under `.opencode/lib/cli-dispatch/`.
- Run tests from the `.opencode/` directory: `bun test` (currently 29 pass, 0 fail).
- Routing rule text is **English** (decided; bilingual only if task 8 validation fails).
- Delegate tool API unchanged: `claude_start`/`claude_reply`/`codex_start`/`codex_reply`, each `(args: { prompt: string }, context) => Promise<string>`.
- Session store API unchanged: `getActiveDelegate(sessionID)`, `setActiveDelegate(sessionID, delegate, externalId)`, `clearActiveDelegate(sessionID)` from `.opencode/lib/cli-dispatch/session-store.ts`; `DelegateName = "codex" | "claude"`.
- Commits: conventional style seen in repo (`feat:`, `fix:`, `docs:`, `refactor:`, `chore:`).

---

### Task 1: Routing rule builder

**Files:**
- Create: `.opencode/lib/cli-dispatch/routing-rule.ts`
- Test: `.opencode/lib/cli-dispatch/routing-rule.test.ts`

**Interfaces:**
- Consumes: `DelegateName` from `./session-store`
- Produces: `buildRoutingRule(delegate: DelegateName): string` — used by Task 2

- [ ] **Step 1: Write the failing test**

Create `.opencode/lib/cli-dispatch/routing-rule.test.ts`:

```ts
import { test, expect } from "bun:test"
import { buildRoutingRule } from "./routing-rule"

test("names the delegate and its reply tool", () => {
  const rule = buildRoutingRule("claude")
  expect(rule).toContain("claude CLI")
  expect(rule).toContain("claude_reply")
})

test("works for codex", () => {
  const rule = buildRoutingRule("codex")
  expect(rule).toContain("codex CLI")
  expect(rule).toContain("codex_reply")
})

test("instructs verbatim forwarding without commentary", () => {
  const rule = buildRoutingRule("claude")
  expect(rule).toContain("verbatim")
  expect(rule).toContain("without adding your own commentary")
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd .opencode && bun test lib/cli-dispatch/routing-rule.test.ts`
Expected: FAIL — `Cannot find module "./routing-rule"`

- [ ] **Step 3: Write minimal implementation**

Create `.opencode/lib/cli-dispatch/routing-rule.ts`:

```ts
import type { DelegateName } from "./session-store"

export function buildRoutingRule(delegate: DelegateName): string {
  return [
    `DELEGATION ACTIVE: this conversation is delegated to the ${delegate} CLI.`,
    `Take the user's latest message verbatim — including any command-injected instructions — and pass it as the "prompt" argument to the ${delegate}_reply tool.`,
    `Return the tool's output to the user without adding your own commentary.`,
    `Do not answer the message yourself, even if other instructions tell you to.`,
  ].join(" ")
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd .opencode && bun test lib/cli-dispatch/routing-rule.test.ts`
Expected: 3 pass, 0 fail

- [ ] **Step 5: Commit**

```bash
git add .opencode/lib/cli-dispatch/routing-rule.ts .opencode/lib/cli-dispatch/routing-rule.test.ts
git commit -m "feat: add routing rule builder for sticky delegation"
```

---

### Task 2: system.transform hook + plugin registration

**Files:**
- Create: `.opencode/lib/cli-dispatch/hooks.ts`
- Test: `.opencode/lib/cli-dispatch/hooks.test.ts`
- Modify: `.opencode/plugin/cli-dispatch.ts`

**Interfaces:**
- Consumes: `buildRoutingRule(delegate: DelegateName): string` (Task 1); `getActiveDelegate(sessionID: string): DelegateSession | undefined` (session-store)
- Produces: `makeSystemTransform(): (input: { sessionID?: string }, output: { system: string[] }) => Promise<void>` — registered in the plugin under `"experimental.chat.system.transform"`

- [ ] **Step 1: Write the failing test**

Create `.opencode/lib/cli-dispatch/hooks.test.ts`:

```ts
import { test, expect, beforeEach } from "bun:test"
import { makeSystemTransform } from "./hooks"
import { setActiveDelegate, clearActiveDelegate } from "./session-store"

beforeEach(() => {
  clearActiveDelegate("session-a")
})

test("appends the routing rule when a delegation is active", async () => {
  setActiveDelegate("session-a", "claude", "uuid-1")
  const output = { system: ["base prompt"] }
  await makeSystemTransform()({ sessionID: "session-a" }, output)
  expect(output.system).toHaveLength(2)
  expect(output.system[1]).toContain("claude_reply")
})

test("does nothing when no delegation is active", async () => {
  const output = { system: ["base prompt"] }
  await makeSystemTransform()({ sessionID: "session-a" }, output)
  expect(output.system).toEqual(["base prompt"])
})

test("does nothing when sessionID is missing", async () => {
  const output = { system: ["base prompt"] }
  await makeSystemTransform()({}, output)
  expect(output.system).toEqual(["base prompt"])
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd .opencode && bun test lib/cli-dispatch/hooks.test.ts`
Expected: FAIL — `Cannot find module "./hooks"`

- [ ] **Step 3: Write minimal implementation**

Create `.opencode/lib/cli-dispatch/hooks.ts`:

```ts
import { getActiveDelegate } from "./session-store"
import { buildRoutingRule } from "./routing-rule"

type SystemTransformInput = { sessionID?: string }
type SystemTransformOutput = { system: string[] }

export function makeSystemTransform() {
  return async (input: SystemTransformInput, output: SystemTransformOutput): Promise<void> => {
    const active = input.sessionID ? getActiveDelegate(input.sessionID) : undefined
    if (!active) return
    output.system.push(buildRoutingRule(active.delegate))
  }
}
```

- [ ] **Step 4: Register the hook in the plugin**

Replace the entire contents of `.opencode/plugin/cli-dispatch.ts` with:

```ts
// .opencode/plugin/cli-dispatch.ts
import type { Plugin } from "@opencode-ai/plugin"
import { DELEGATES, makeStartTool, makeReplyTool } from "../lib/cli-dispatch/delegate-tools"
import { makeSystemTransform } from "../lib/cli-dispatch/hooks"

const CliDispatchPlugin: Plugin = async () => {
  return {
    tool: Object.fromEntries(
      Object.values(DELEGATES).flatMap((cfg) => [
        [`${cfg.name}_start`, makeStartTool(cfg)],
        [`${cfg.name}_reply`, makeReplyTool(cfg)],
      ]),
    ),
    "experimental.chat.system.transform": makeSystemTransform(),
  }
}

export default CliDispatchPlugin
```

- [ ] **Step 5: Run tests**

Run: `cd .opencode && bun test`
Expected: all pass (32 total: 29 existing + 3 new)

- [ ] **Step 6: Commit**

```bash
git add .opencode/lib/cli-dispatch/hooks.ts .opencode/lib/cli-dispatch/hooks.test.ts .opencode/plugin/cli-dispatch.ts
git commit -m "feat: inject delegation routing rule via system.transform hook"
```

---

### Task 3: Mention rewrite + chat.message hook

**Files:**
- Modify: `.opencode/lib/cli-dispatch/hooks.ts` (append)
- Test: `.opencode/lib/cli-dispatch/hooks.test.ts` (append)
- Modify: `.opencode/plugin/cli-dispatch.ts` (one line)

**Interfaces:**
- Consumes: `getActiveDelegate` (session-store)
- Produces:
  - `MENTION_BOILERPLATE: RegExp`
  - `rewriteMentionBoilerplate(parts: Array<{ type: string; name?: string; text?: string }>): void` — mutates in place
  - `makeChatMessage(): (input: { sessionID: string }, output: { parts: Array<{ type: string; name?: string; text?: string }> }) => Promise<void>` — registered under `"chat.message"`

- [ ] **Step 1: Write the failing tests**

Append to `.opencode/lib/cli-dispatch/hooks.test.ts` (add `makeChatMessage` to the import from `./hooks`):

```ts
test("rewrites mention boilerplate while delegated", async () => {
  setActiveDelegate("session-a", "claude", "uuid-1")
  const parts = [
    { type: "agent", name: "explore" },
    { type: "text", text: " Use the above message and context to generate a prompt and call the task tool with subagent: explore" },
    { type: "text", text: "look at the deps" },
  ]
  await makeChatMessage()({ sessionID: "session-a" }, { parts })
  expect(parts[1].text).toBe('The user mentioned the "explore" agent for the following request:')
  expect(parts[2].text).toBe("look at the deps")
})

test("leaves mention boilerplate untouched when not delegated", async () => {
  const boilerplate = " Use the above message and context to generate a prompt and call the task tool with subagent: explore"
  const parts = [
    { type: "agent", name: "explore" },
    { type: "text", text: boilerplate },
  ]
  await makeChatMessage()({ sessionID: "session-a" }, { parts })
  expect(parts[1].text).toBe(boilerplate)
})

test("leaves parts untouched when there is no mention", async () => {
  setActiveDelegate("session-a", "claude", "uuid-1")
  const parts = [{ type: "text", text: "hello" }]
  await makeChatMessage()({ sessionID: "session-a" }, { parts })
  expect(parts[0].text).toBe("hello")
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd .opencode && bun test lib/cli-dispatch/hooks.test.ts`
Expected: FAIL — `makeChatMessage is not exported` (or type error)

- [ ] **Step 3: Implement**

Append to `.opencode/lib/cli-dispatch/hooks.ts`:

```ts
export const MENTION_BOILERPLATE =
  /^\s*Use the above message and context to generate a prompt and call the task tool with subagent:\s*[\w-]+\s*\.?\s*$/

type PartLike = { type: string; name?: string; text?: string }

export function rewriteMentionBoilerplate(parts: PartLike[]): void {
  const mention = parts.find((p) => p.type === "agent" && typeof p.name === "string")
  if (!mention || !mention.name) return
  for (const part of parts) {
    if (part.type === "text" && typeof part.text === "string" && MENTION_BOILERPLATE.test(part.text)) {
      part.text = `The user mentioned the "${mention.name}" agent for the following request:`
    }
  }
}

type ChatMessageInput = { sessionID: string }
type ChatMessageOutput = { parts: PartLike[] }

export function makeChatMessage() {
  return async (input: ChatMessageInput, output: ChatMessageOutput): Promise<void> => {
    const active = getActiveDelegate(input.sessionID)
    if (!active) return
    rewriteMentionBoilerplate(output.parts)
  }
}
```

- [ ] **Step 4: Register in plugin**

In `.opencode/plugin/cli-dispatch.ts`, add `makeChatMessage` to the hooks import and add one line to the returned object, directly below the system.transform line:

```ts
import { makeSystemTransform, makeChatMessage } from "../lib/cli-dispatch/hooks"
```

```ts
    "experimental.chat.system.transform": makeSystemTransform(),
    "chat.message": makeChatMessage(),
```

- [ ] **Step 5: Run tests**

Run: `cd .opencode && bun test`
Expected: all pass (35 total)

- [ ] **Step 6: Commit**

```bash
git add .opencode/lib/cli-dispatch/hooks.ts .opencode/lib/cli-dispatch/hooks.test.ts .opencode/plugin/cli-dispatch.ts
git commit -m "feat: rewrite agent-mention boilerplate while delegated"
```

---

### Task 4: Exit hook (command.execute.before)

**Files:**
- Modify: `.opencode/lib/cli-dispatch/hooks.ts` (append)
- Test: `.opencode/lib/cli-dispatch/hooks.test.ts` (append)
- Modify: `.opencode/plugin/cli-dispatch.ts` (one line)

**Interfaces:**
- Consumes: `getActiveDelegate`, `clearActiveDelegate` (session-store)
- Produces: `makeCommandBefore(): (input: { command: string; sessionID: string }, output: { parts: Array<{ type: string; text?: string; synthetic?: boolean }> }) => Promise<void>` — registered under `"command.execute.before"`

- [ ] **Step 1: Write the failing tests**

Append to `.opencode/lib/cli-dispatch/hooks.test.ts` (add `makeCommandBefore` to the import, and `getActiveDelegate` to the session-store import):

```ts
test("clears an active delegation and notes which delegate was exited", async () => {
  setActiveDelegate("session-a", "claude", "uuid-1")
  const output: { parts: Array<{ type: string; text?: string; synthetic?: boolean }> } = { parts: [] }
  await makeCommandBefore()({ command: "opencode", sessionID: "session-a" }, output)
  expect(getActiveDelegate("session-a")).toBeUndefined()
  expect(output.parts[0].text).toBe("[plugin] Cleared the active claude delegation for this session.")
})

test("notes when no delegation was active", async () => {
  const output: { parts: Array<{ type: string; text?: string; synthetic?: boolean }> } = { parts: [] }
  await makeCommandBefore()({ command: "opencode", sessionID: "session-a" }, output)
  expect(output.parts[0].text).toBe("[plugin] No CLI delegation was active for this session.")
})

test("ignores other commands and preserves state", async () => {
  setActiveDelegate("session-a", "claude", "uuid-1")
  const output: { parts: Array<{ type: string; text?: string; synthetic?: boolean }> } = { parts: [] }
  await makeCommandBefore()({ command: "opsx-explore", sessionID: "session-a" }, output)
  expect(output.parts).toHaveLength(0)
  expect(getActiveDelegate("session-a")).toEqual({ delegate: "claude", externalId: "uuid-1" })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd .opencode && bun test lib/cli-dispatch/hooks.test.ts`
Expected: FAIL — `makeCommandBefore is not exported`

- [ ] **Step 3: Implement**

Append to `.opencode/lib/cli-dispatch/hooks.ts`:

```ts
type CommandBeforeInput = { command: string; sessionID: string }
type CommandBeforeOutput = { parts: Array<{ type: string; text?: string; synthetic?: boolean }> }

export function makeCommandBefore() {
  return async (input: CommandBeforeInput, output: CommandBeforeOutput): Promise<void> => {
    if (input.command !== "opencode") return
    const active = getActiveDelegate(input.sessionID)
    clearActiveDelegate(input.sessionID)
    const note = active
      ? `[plugin] Cleared the active ${active.delegate} delegation for this session.`
      : "[plugin] No CLI delegation was active for this session."
    output.parts.push({ type: "text", text: note, synthetic: true })
  }
}
```

- [ ] **Step 4: Register in plugin**

In `.opencode/plugin/cli-dispatch.ts`, extend the hooks import and add one line below the chat.message line:

```ts
import { makeSystemTransform, makeChatMessage, makeCommandBefore } from "../lib/cli-dispatch/hooks"
```

```ts
    "chat.message": makeChatMessage(),
    "command.execute.before": makeCommandBefore(),
```

- [ ] **Step 5: Run tests**

Run: `cd .opencode && bun test`
Expected: all pass (38 total)

- [ ] **Step 6: Commit**

```bash
git add .opencode/lib/cli-dispatch/hooks.ts .opencode/lib/cli-dispatch/hooks.test.ts .opencode/plugin/cli-dispatch.ts
git commit -m "feat: clear delegation deterministically on /opencode command"
```

---

### Task 5: /opencode command file

**Files:**
- Create: `.opencode/command/opencode.md`

**Interfaces:**
- Consumes: the `[plugin]` note part appended by `makeCommandBefore` (Task 4)
- Produces: command named `opencode` (file name determines command name)

- [ ] **Step 1: Create the command**

Create `.opencode/command/opencode.md`:

```markdown
---
description: Exit CLI delegation (/cc or /codex) and return to opencode (sticky off)
---

The plugin has already cleared any active CLI delegation for this session — look for a `[plugin]` note in this message stating what happened. Reply in one or two sentences, relaying that note: if a delegation was cleared, say which delegate was exited and that opencode is handling the conversation directly again; if no delegation was active, say so. Do not call any delegate tool in response to this command.
```

Note: the template is deliberately correct even if the note part is missing (the `chat.message`/`command.execute.before` part-push is verified in Task 8; the template does not depend on it).

- [ ] **Step 2: Verify the command is discovered**

Run: `opencode serve --port 4101 &` from the repo root, wait 3s, then:

```bash
AUTH="$OPENCODE_SERVER_USERNAME:$OPENCODE_SERVER_PASSWORD"
curl -s -u "$AUTH" http://127.0.0.1:4101/command | python3 -c "import json,sys; print([c['name'] for c in json.load(sys.stdin)])"
pkill -f "opencode serve --port 4101"
```

Expected: list contains `"opencode"`

- [ ] **Step 3: Commit**

```bash
git add .opencode/command/opencode.md
git commit -m "feat: add /opencode command for exiting delegation"
```

---

### Task 6: Failure hint in delegate tools

**Files:**
- Modify: `.opencode/lib/cli-dispatch/delegate-tools.ts` (two return strings, lines ~59 and ~86)
- Test: `.opencode/lib/cli-dispatch/delegate-tools.test.ts` (update line 68, append one test)

**Interfaces:**
- Produces: new failure-string contract `"<name> failed: <message>. Use /opencode to exit delegation."` from both `makeStartTool` and `makeReplyTool` error paths

- [ ] **Step 1: Update the existing failing expectation and add a new failing test**

In `.opencode/lib/cli-dispatch/delegate-tools.test.ts`, change line 68 from:

```ts
  expect(output).toBe("codex failed: spawn codex failed")
```

to:

```ts
  expect(output).toBe("codex failed: spawn codex failed. Use /opencode to exit delegation.")
```

Append at the end of the file:

```ts
test("reply failure keeps delegation state and hints at /opencode", async () => {
  setActiveDelegate("session-a", "codex", "thread-1")
  const reply = makeReplyTool(DELEGATES.codex, failingRun("boom"))
  const output = await reply.execute({ prompt: "hi" }, fakeContext("session-a"))
  expect(output).toBe("codex failed: boom. Use /opencode to exit delegation.")
  expect(getActiveDelegate("session-a")).toEqual({ delegate: "codex", externalId: "thread-1" })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd .opencode && bun test lib/cli-dispatch/delegate-tools.test.ts`
Expected: 2 FAIL — old strings returned, hint missing

- [ ] **Step 3: Implement**

In `.opencode/lib/cli-dispatch/delegate-tools.ts`, change BOTH error returns (one in `makeStartTool`, one in `makeReplyTool`) from:

```ts
        return `${cfg.name} failed: ${err instanceof Error ? err.message : String(err)}`
```

to:

```ts
        return `${cfg.name} failed: ${err instanceof Error ? err.message : String(err)}. Use /opencode to exit delegation.`
```

- [ ] **Step 4: Run tests**

Run: `cd .opencode && bun test`
Expected: all pass (39 total)

- [ ] **Step 5: Commit**

```bash
git add .opencode/lib/cli-dispatch/delegate-tools.ts .opencode/lib/cli-dispatch/delegate-tools.test.ts
git commit -m "feat: hint at /opencode exit in delegate failure messages"
```

---

### Task 7: Command docs (cc.md / codex.md)

**Files:**
- Modify: `.opencode/command/cc.md`
- Modify: `.opencode/command/codex.md`

**Interfaces:**
- Consumes: behaviors from Tasks 2–6 (routing rule, mention forwarding, `/opencode` exit, failure hint)
- Produces: user-facing command docs describing exit path and forwarding semantics

- [ ] **Step 1: Append to cc.md**

Append to `.opencode/command/cc.md`:

```markdown

**Exiting delegation:** run `/opencode` to end the delegation for this session (cleared deterministically by the plugin; afterwards opencode answers directly again). While a delegation is active, ALL user input is forwarded to claude as prompt content — including non-delegate commands (e.g. `/opsx-explore`) and agent mentions (e.g. `@explore`). If claude fails, the error message will remind you about `/opencode`; the delegation stays active so you can fix the problem and continue, or exit.
```

- [ ] **Step 2: Append to codex.md**

Append to `.opencode/command/codex.md`:

```markdown

**Exiting delegation:** run `/opencode` to end the delegation for this session (cleared deterministically by the plugin; afterwards opencode answers directly again). While a delegation is active, ALL user input is forwarded to codex as prompt content — including non-delegate commands (e.g. `/opsx-explore`) and agent mentions (e.g. `@explore`). If codex fails, the error message will remind you about `/opencode`; the delegation stays active so you can fix the problem and continue, or exit.
```

- [ ] **Step 3: Commit**

```bash
git add .opencode/command/cc.md .opencode/command/codex.md
git commit -m "docs: describe /opencode exit and forwarding semantics in delegate commands"
```

---

### Task 8: Integration verification (manual, live)

**Files:**
- No file changes. Verification only; uses `openspec/changes/sticky-cli-delegation/tasks.md` item 4.4/5.1 as the checklist source.

**Interfaces:**
- Consumes: everything from Tasks 1–7
- Produces: verified behavior + updated checkboxes in `openspec/changes/sticky-cli-delegation/tasks.md`

- [ ] **Step 1: Start the server**

From the repo root, terminal 1:

```bash
opencode serve --port 4102
```

- [ ] **Step 2: Run the verification sequence**

Terminal 2:

```bash
AUTH="$OPENCODE_SERVER_USERNAME:$OPENCODE_SERVER_PASSWORD"
BASE=http://127.0.0.1:4102
SID=$(curl -s -u "$AUTH" -X POST $BASE/session -H 'Content-Type: application/json' -d '{"title":"sticky-verify"}' | python3 -c "import json,sys;print(json.load(sys.stdin)['id'])")

# A. start delegation
curl -s -u "$AUTH" -X POST $BASE/session/$SID/command -H 'Content-Type: application/json' -d '{"command":"cc","arguments":"Remember the codename PELICAN. Confirm you received it in one word."}'
sleep 30

# B. plain follow-up (should stay with claude)
curl -s -u "$AUTH" -X POST $BASE/session/$SID/message -H 'Content-Type: application/json' -d '{"parts":[{"type":"text","text":"What is the codename? One word."}]}'
sleep 30

# C. intervening command (should forward to claude, not break delegation)
curl -s -u "$AUTH" -X POST $BASE/session/$SID/command -H 'Content-Type: application/json' -d '{"command":"opsx-explore","arguments":"briefly: what codename did I give?"}'
sleep 40

# D. @explore mention (should forward with translated intent, still claude)
curl -s -u "$AUTH" -X POST $BASE/session/$SID/message -H 'Content-Type: application/json' -d '{"parts":[{"type":"agent","name":"explore"},{"type":"text","text":"What is the codename? One word."}]}'
sleep 30

# E. exit
curl -s -u "$AUTH" -X POST $BASE/session/$SID/command -H 'Content-Type: application/json' -d '{"command":"opencode","arguments":""}'
sleep 15

# F. plain message after exit (should be opencode's own model, NOT claude)
curl -s -u "$AUTH" -X POST $BASE/session/$SID/message -H 'Content-Type: application/json' -d '{"parts":[{"type":"text","text":"What is the codename? If you do not know, say UNKNOWN."}]}'
sleep 20

# G. exit with no delegation (no-op notice)
curl -s -u "$AUTH" -X POST $BASE/session/$SID/command -H 'Content-Type: application/json' -d '{"command":"opencode","arguments":""}'
sleep 15

# inspect the transcript
curl -s -u "$AUTH" "$BASE/session/$SID/message" | python3 -c "
import json,sys
for m in json.load(sys.stdin):
    role=m.get('info',{}).get('role')
    for p in m.get('parts',[]):
        if p.get('type')=='text':
            print(role, '>>>', p['text'][:160].replace(chr(10),' | '))
"
```

- [ ] **Step 3: Check expected outcomes**

| Step | Expected |
|------|----------|
| B | claude answers PELICAN |
| C | claude (not opencode) answers, in explore stance, knows PELICAN |
| D | claude answers PELICAN; the forwarded text does NOT contain "call the task tool with subagent" |
| E | reply confirms claude delegation was cleared |
| F | opencode's own model answers UNKNOWN (it never saw the codename — proof it left claude's context) |
| G | reply states no delegation was active |
| B2 (switch) | codex active + /cc → claude_start called (template NOT forwarded to codex_reply); follow-ups go to claude |

- [ ] **Step 4: Third-party provider rerun**

Repeat Steps 1–3 in a fresh session with opencode's model set to a third-party provider (e.g. pass `"model":{"providerID":"kimi-for-coding","modelID":"<model>"}` in the message bodies, or switch the default model first). If the English routing rule fails to hold across step C, adjust the rule wording in `.opencode/lib/cli-dispatch/routing-rule.ts` (bilingual fallback per design.md Open Questions resolution) and re-run Task 1 tests.

- [ ] **Step 5: Cleanup and check off OpenSpec tasks**

```bash
pkill -f "opencode serve --port 4102"
```

Check off completed items in `openspec/changes/sticky-cli-delegation/tasks.md` (all of groups 1–5), then:

```bash
git add openspec/changes/sticky-cli-delegation/tasks.md
git commit -m "chore: mark sticky-cli-delegation tasks complete after verification"
```

---

## Self-Review Notes

- **Spec coverage:** sticky routing (MODIFIED req) → Tasks 1–2; command forwarding → Tasks 2 (verified 8C); mention translation → Task 3 (verified 8D); exit (ADDED req) → Tasks 4–5 (verified 8E–G); failure guidance (ADDED req) → Task 6; docs → Task 7; third-party validation → Task 8 Step 4.
- **Placeholder scan:** none — all code and commands complete.
- **Type consistency:** `buildRoutingRule` (Task 1) consumed by Task 2 with the same signature; `makeSystemTransform`/`makeChatMessage`/`makeCommandBefore` names match between hooks.ts, hooks.test.ts, and plugin registration in Tasks 2–4; failure-string contract identical in Task 6 test and implementation.
- **Known unverified-at-runtime assumption:** pushing a part in `command.execute.before` (Task 4) and in-place text mutation in `chat.message` (Task 3) were not covered by the earlier spike (only reads were). Task 5's command template is written to be correct without the note part, and Task 8 steps D/E verify both behaviors live; if the push fails at runtime, fall back to template-only wording and record the limitation in design.md.
