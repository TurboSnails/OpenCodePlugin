import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { mkdtempSync, rmSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"
import { startDelegate, replyDelegate } from "../claude-code-adapter/delegate-tools"
import { getActiveDelegate } from "../claude-code-adapter/session-store"
import type { DelegateConfig } from "../config"

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "cli-dispatch-cc-tools-test-"))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

const codexConfig: DelegateConfig = {
  binary: "codex",
  parser: "codex",
  startArgs: ["exec", "--", "{prompt}"],
  replyArgs: ["exec", "resume", "{externalId}", "--", "{prompt}"],
}

describe("startDelegate", () => {
  it("registers the CLI-reported externalId as the active delegate", async () => {
    const fakeRun = async () => ({ finalText: "hi", externalId: "thread-1", stderrText: "" })
    const reply = await startDelegate("codex", codexConfig, "cc-session-a", "hello", {
      run: fakeRun as any,
      stateDir: dir,
    })

    expect(reply).toBe("hi")
    expect(getActiveDelegate("cc-session-a", dir)).toEqual({ delegate: "codex", externalId: "thread-1" })
  })

  it("falls back to the client-generated sessionId when the parser reports no externalId", async () => {
    let capturedArgs: string[] = []
    const withSessionId: DelegateConfig = {
      ...codexConfig,
      startArgs: ["exec", "--session-id", "{sessionId}", "--", "{prompt}"],
    }
    const fakeRun = async (options: { args: string[] }) => {
      capturedArgs = options.args
      return { finalText: "hi", externalId: undefined, stderrText: "" }
    }

    await startDelegate("codex", withSessionId, "cc-session-b", "hello", { run: fakeRun as any, stateDir: dir })

    const sentSessionId = capturedArgs[capturedArgs.indexOf("--session-id") + 1]
    expect(getActiveDelegate("cc-session-b", dir)?.externalId).toBe(sentSessionId)
  })

  it("returns an actionable message instead of throwing when the CLI fails", async () => {
    const fakeRun = async () => {
      throw new Error("codex exited with code 1: boom")
    }
    const reply = await startDelegate("codex", codexConfig, "cc-session-c", "hello", {
      run: fakeRun as any,
      stateDir: dir,
    })

    expect(reply).toContain("codex failed")
    expect(reply).toContain("/cc")
    expect(getActiveDelegate("cc-session-c", dir)).toBeUndefined()
  })

  it("passes a default 10-minute timeout to the run", async () => {
    let captured: { timeoutMs?: number } = {}
    const fakeRun = async (options: { timeoutMs?: number }) => {
      captured = options
      return { finalText: "hi", externalId: undefined, stderrText: "" }
    }
    await startDelegate("codex", codexConfig, "cc-session-d", "hello", { run: fakeRun as any, stateDir: dir })
    expect(captured.timeoutMs).toBe(10 * 60 * 1000)
  })

  it("keeps the delegate from the latest initiated start when concurrent starts race", async () => {
    let resolveFirst!: () => void
    let resolveSecond!: () => void
    const firstRun = new Promise<{ finalText: string; externalId: string; stderrText: string }>((resolve) => {
      resolveFirst = () => resolve({ finalText: "first", externalId: "thread-first", stderrText: "" })
    })
    const secondRun = new Promise<{ finalText: string; externalId: string; stderrText: string }>((resolve) => {
      resolveSecond = () => resolve({ finalText: "second", externalId: "thread-second", stderrText: "" })
    })
    const fakeRun = async (options: { args: string[] }) =>
      options.args.includes("first task") ? firstRun : secondRun

    const firstStart = startDelegate("codex", codexConfig, "cc-session-race", "first task", {
      run: fakeRun as any,
      stateDir: dir,
    })
    const secondStart = startDelegate("codex", codexConfig, "cc-session-race", "second task", {
      run: fakeRun as any,
      stateDir: dir,
    })

    resolveSecond()
    await secondStart
    resolveFirst()
    await firstStart

    expect(getActiveDelegate("cc-session-race", dir)?.externalId).toBe("thread-second")
  })
})

describe("replyDelegate", () => {
  it("rejects before calling the CLI when no session is active", async () => {
    let replyCalled = false
    const fakeRun = async () => {
      replyCalled = true
      return { finalText: "nope", externalId: undefined, stderrText: "" }
    }

    await expect(
      replyDelegate("codex", codexConfig, "cc-session-e", "follow up", { run: fakeRun as any, stateDir: dir }),
    ).rejects.toThrow("No active codex session for this conversation. Call codex_start first.")
    expect(replyCalled).toBe(false)
  })

  it("rejects when a different delegate is active", async () => {
    const fakeStartRun = async () => ({ finalText: "hi", externalId: "thread-1", stderrText: "" })
    await startDelegate("codex", codexConfig, "cc-session-f", "hello", { run: fakeStartRun as any, stateDir: dir })

    await expect(
      replyDelegate("opencode", codexConfig, "cc-session-f", "follow up", { run: fakeStartRun as any, stateDir: dir }),
    ).rejects.toThrow("No active opencode session")
  })

  it("continues the stored external session id after start", async () => {
    const fakeStartRun = async () => ({ finalText: "hi", externalId: "thread-1", stderrText: "" })
    let capturedArgs: string[] = []
    const fakeReplyRun = async (options: { args: string[] }) => {
      capturedArgs = options.args
      return { finalText: "hello again", externalId: undefined, stderrText: "" }
    }

    await startDelegate("codex", codexConfig, "cc-session-g", "hello", { run: fakeStartRun as any, stateDir: dir })
    const reply = await replyDelegate("codex", codexConfig, "cc-session-g", "follow up", {
      run: fakeReplyRun as any,
      stateDir: dir,
    })

    expect(reply).toBe("hello again")
    expect(capturedArgs).toEqual(["exec", "resume", "thread-1", "--", "follow up"])
  })
})
