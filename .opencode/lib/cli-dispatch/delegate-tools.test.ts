// .opencode/lib/cli-dispatch/delegate-tools.test.ts
import { test, expect, beforeEach } from "bun:test"
import {
  makeStartTool,
  makeReplyTool,
  DELEGATES,
  type RunDelegateFn,
} from "./delegate-tools"
import { getActiveDelegate, setActiveDelegate, clearActiveDelegate } from "./session-store"
import type { RunDelegateResult } from "./run-delegate"

type RunCall = { binary: string; args: string[] }

function recordingRun(result: Partial<RunDelegateResult>, calls: RunCall[] = []): RunDelegateFn {
  return async (options) => {
    calls.push({ binary: options.binary, args: options.args })
    return { finalText: "", stderrText: "", ...result }
  }
}

function failingRun(message: string): RunDelegateFn {
  return async () => {
    throw new Error(message)
  }
}

function fakeContext(sessionID: string) {
  return {
    sessionID,
    messageID: "msg-test",
    agent: "test",
    directory: "/tmp",
    worktree: "/tmp",
    abort: new AbortController().signal,
    metadata: () => {},
    ask: async () => {},
  }
}

beforeEach(() => {
  clearActiveDelegate("session-a")
})

test("start tool runs the delegate binary with start args and stores the streamed external id", async () => {
  const calls: RunCall[] = []
  const start = makeStartTool(DELEGATES.codex, recordingRun({ finalText: "PONG", externalId: "thread-1" }, calls))
  const output = await start.execute({ prompt: "hi" }, fakeContext("session-a"))
  expect(output).toBe("PONG")
  expect(calls[0].binary).toBe("codex")
  expect(calls[0].args).toEqual(["exec", "--json", "-c", "sandbox_mode=read-only", "--skip-git-repo-check", "--", "hi"])
  expect(getActiveDelegate("session-a")).toEqual({ delegate: "codex", externalId: "thread-1" })
})

test("claude start tool stores its pre-generated session id even when the stream yields none", async () => {
  const calls: RunCall[] = []
  const start = makeStartTool(DELEGATES.claude, recordingRun({ finalText: "OK" }, calls))
  await start.execute({ prompt: "hi" }, fakeContext("session-a"))
  const active = getActiveDelegate("session-a")
  expect(active?.delegate).toBe("claude")
  expect(typeof active?.externalId).toBe("string")
  const flagIndex = calls[0].args.indexOf("--session-id")
  expect(calls[0].args[flagIndex + 1]).toBe(active?.externalId)
})

test("start tool returns an error string and stores nothing when the run fails", async () => {
  const start = makeStartTool(DELEGATES.codex, failingRun("spawn codex failed"))
  const output = await start.execute({ prompt: "hi" }, fakeContext("session-a"))
  expect(output).toBe("codex failed: spawn codex failed")
  expect(getActiveDelegate("session-a")).toBeUndefined()
})

test("start tool falls back to a placeholder when the delegate produced no text", async () => {
  const start = makeStartTool(DELEGATES.codex, recordingRun({}))
  const output = await start.execute({ prompt: "hi" }, fakeContext("session-a"))
  expect(output).toBe("(codex returned no text response)")
  expect(getActiveDelegate("session-a")).toBeUndefined()
})

test("reply tool throws when no delegate is active for the session", async () => {
  const reply = makeReplyTool(DELEGATES.codex, recordingRun({}))
  await expect(reply.execute({ prompt: "hi" }, fakeContext("session-a"))).rejects.toThrow(
    "No active codex session",
  )
})

test("reply tool continues the stored thread id", async () => {
  setActiveDelegate("session-a", "codex", "thread-9")
  const calls: RunCall[] = []
  const reply = makeReplyTool(DELEGATES.codex, recordingRun({ finalText: "REPLY" }, calls))
  const output = await reply.execute({ prompt: "next" }, fakeContext("session-a"))
  expect(output).toBe("REPLY")
  expect(calls[0].args).toEqual([
    "exec",
    "resume",
    "thread-9",
    "--json",
    "-c",
    "sandbox_mode=read-only",
    "--skip-git-repo-check",
    "--",
    "next",
  ])
})

test("plugin wires exactly the four delegate tools", async () => {
  const { default: CliDispatchPlugin } = await import("../../plugin/cli-dispatch")
  const hooks = await CliDispatchPlugin({} as any)
  expect(Object.keys(hooks.tool ?? {}).sort()).toEqual([
    "claude_reply",
    "claude_start",
    "codex_reply",
    "codex_start",
  ])
})

test("start tool forwards delegate progress into context metadata", async () => {
  const seen: unknown[] = []
  const run: RunDelegateFn = async (options) => {
    options.onProgress("working on it")
    return { finalText: "done", externalId: "thread-1", stderrText: "" }
  }
  const context = { ...fakeContext("session-a"), metadata: (input: unknown) => seen.push(input) }
  const start = makeStartTool(DELEGATES.codex, run)
  await start.execute({ prompt: "hi" }, context)
  expect(seen).toContainEqual({ title: "codex", metadata: { progress: "working on it" } })
})
