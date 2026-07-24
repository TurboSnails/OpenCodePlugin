import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"
import { snapshotWorktree, buildChangeSummary, makeStartTool, makeReplyTool } from "../delegate-tools"
import type { DelegateConfig } from "../config"
import { getActiveDelegate, setSessionAgent } from "../session-store"
import { makeChatMessage } from "../hooks"

let dir: string

function git(...args: string[]) {
  const result = Bun.spawnSync(
    ["git", "-c", "user.email=test@test", "-c", "user.name=test", ...args],
    { cwd: dir },
  )
  if (!result.success) throw new Error(`git ${args[0]} failed: ${result.stderr.toString()}`)
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "cli-dispatch-git-test-"))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

function initRepoWithCommit() {
  git("init")
  writeFileSync(join(dir, "config.ts"), "export const x = 1\n")
  git("add", ".")
  git("commit", "-m", "init")
}

describe("snapshotWorktree", () => {
  it("returns null outside a git repository", () => {
    expect(snapshotWorktree(dir)).toBeNull()
  })

  it("returns empty string for a clean repository", () => {
    initRepoWithCommit()
    expect(snapshotWorktree(dir)).toBe("")
  })
})

describe("buildChangeSummary", () => {
  it("returns null when nothing changed", () => {
    initRepoWithCommit()
    const snap = snapshotWorktree(dir)!
    expect(buildChangeSummary(snap, snap, dir)).toBeNull()
  })

  it("summarizes tracked modifications and new untracked files", () => {
    initRepoWithCommit()
    const before = snapshotWorktree(dir)!

    writeFileSync(join(dir, "config.ts"), "export const x = 2\n")
    writeFileSync(join(dir, "notes.md"), "hello\n")

    const after = snapshotWorktree(dir)!
    const summary = buildChangeSummary(before, after, dir)

    expect(summary).not.toBeNull()
    expect(summary).toContain("Changed during this run:")
    expect(summary).toContain("config.ts")
    expect(summary).toContain("new file: notes.md")
  })

  it("does not list untracked files that existed before the run", () => {
    initRepoWithCommit()
    writeFileSync(join(dir, "old-scratch.txt"), "was here\n")
    const before = snapshotWorktree(dir)!

    writeFileSync(join(dir, "config.ts"), "export const x = 2\n")

    const after = snapshotWorktree(dir)!
    const summary = buildChangeSummary(before, after, dir)

    expect(summary).not.toBeNull()
    expect(summary).toContain("config.ts")
    expect(summary).not.toContain("old-scratch.txt")
  })

  it("truncates past 50 lines and marks the summary as truncated", () => {
    initRepoWithCommit()
    const before = snapshotWorktree(dir)!

    for (let i = 0; i < 60; i++) {
      writeFileSync(join(dir, `new-file-${i}.txt`), "x\n")
    }

    const after = snapshotWorktree(dir)!
    const summary = buildChangeSummary(before, after, dir)!

    expect(summary).not.toBeNull()
    expect(summary).toContain("... (truncated)")
    const newFileLines = summary.split("\n").filter((l) => l.startsWith("new file: "))
    expect(newFileLines.length).toBe(50)
  })
})

const claudeConfig: DelegateConfig = {
  binary: "claude",
  parser: "claude",
  startArgs: ["--session-id", "{sessionId}", "--", "{prompt}"],
  replyArgs: ["--resume", "{externalId}", "--", "{prompt}"],
}

function fakeContext(sessionID: string) {
  return {
    sessionID,
    messageID: "msg-1",
    agent: "test",
    directory: process.cwd(),
    worktree: process.cwd(),
    abort: new AbortController().signal,
    metadata: () => {},
    ask: async () => {},
  }
}

describe("makeStartTool", () => {
  it("registers the client-generated sessionId as the active delegate when the parser returns no externalId", async () => {
    let capturedArgs: string[] = []
    const fakeRun = async (options: { args: string[] }) => {
      capturedArgs = options.args
      return { finalText: "hi", externalId: undefined, stderrText: "" }
    }

    const startTool = makeStartTool("claude", claudeConfig, fakeRun as any)
    const context = fakeContext("session-a")
    await startTool.execute({ prompt: "hello" }, context as any)

    const sessionIdArgIndex = capturedArgs.indexOf("--session-id") + 1
    const sentSessionId = capturedArgs[sessionIdArgIndex]

    const active = getActiveDelegate("session-a")
    expect(active).toBeDefined()
    expect(active?.delegate).toBe("claude")
    expect(active?.externalId).toBe(sentSessionId)
  })

  it("prefers the externalId reported by the CLI over the client-generated sessionId", async () => {
    let capturedArgs: string[] = []
    const fakeRun = async (options: { args: string[] }) => {
      capturedArgs = options.args
      return { finalText: "hi", externalId: "cli-reported-thread", stderrText: "" }
    }

    const startTool = makeStartTool("claude", claudeConfig, fakeRun as any)
    const context = fakeContext("session-cli-external-id")
    await startTool.execute({ prompt: "hello" }, context as any)

    const sessionIdArgIndex = capturedArgs.indexOf("--session-id") + 1
    const sentSessionId = capturedArgs[sessionIdArgIndex]
    const active = getActiveDelegate(context.sessionID)

    expect(active?.externalId).toBe("cli-reported-thread")
    expect(active?.externalId).not.toBe(sentSessionId)
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

    const startTool = makeStartTool("claude", claudeConfig, fakeRun as any)
    const context = fakeContext("same-session-race")
    const firstStart = startTool.execute({ prompt: "first task" }, context as any)
    const secondStart = startTool.execute({ prompt: "second task" }, context as any)

    resolveSecond()
    await secondStart
    resolveFirst()
    await firstStart

    expect(getActiveDelegate(context.sessionID)?.externalId).toBe("thread-second")
  })

  it("passes a default 10-minute timeout and the context abort signal to the run", async () => {
    let captured: { timeoutMs?: number; signal?: AbortSignal } = {}
    const fakeRun = async (options: { timeoutMs?: number; signal?: AbortSignal }) => {
      captured = options
      return { finalText: "hi", externalId: undefined, stderrText: "" }
    }

    const startTool = makeStartTool("claude", claudeConfig, fakeRun as any)
    const context = fakeContext("session-timeout-default")
    await startTool.execute({ prompt: "hello" }, context as any)

    expect(captured.timeoutMs).toBe(10 * 60 * 1000)
    expect(captured.signal).toBe(context.abort)
  })

  it("prefers the delegate config timeoutMs over the default", async () => {
    let captured: { timeoutMs?: number } = {}
    const fakeRun = async (options: { timeoutMs?: number }) => {
      captured = options
      return { finalText: "hi", externalId: undefined, stderrText: "" }
    }

    const startTool = makeStartTool("claude", { ...claudeConfig, timeoutMs: 30000 }, fakeRun as any)
    const context = fakeContext("session-timeout-override")
    await startTool.execute({ prompt: "hello" }, context as any)

    expect(captured.timeoutMs).toBe(30000)
  })

  it("runs the delegate CLI in the session project directory from the tool context", async () => {
    let captured: { cwd?: string } = {}
    const fakeRun = async (options: { cwd?: string }) => {
      captured = options
      return { finalText: "hi", externalId: undefined, stderrText: "" }
    }

    const startTool = makeStartTool("claude", claudeConfig, fakeRun as any)
    const context = { ...fakeContext("session-start-cwd"), directory: "/tmp/session-project-dir" }
    await startTool.execute({ prompt: "hello" }, context as any)

    expect(captured.cwd).toBe("/tmp/session-project-dir")
  })

  it("falls back to the process cwd when the tool context has no directory", async () => {
    let captured: { cwd?: string } = {}
    const fakeRun = async (options: { cwd?: string }) => {
      captured = options
      return { finalText: "hi", externalId: undefined, stderrText: "" }
    }

    const startTool = makeStartTool("claude", claudeConfig, fakeRun as any)
    const context = { ...fakeContext("session-start-cwd-fallback"), directory: undefined }
    await startTool.execute({ prompt: "hello" }, context as any)

    expect(captured.cwd).toBe(process.cwd())
  })

  it("builds the change summary from the session project directory, not the process cwd", async () => {
    initRepoWithCommit()
    const fakeRun = async () => {
      writeFileSync(join(dir, "delegate-made-this.md"), "hello\n")
      return { finalText: "hi", externalId: undefined, stderrText: "" }
    }

    const startTool = makeStartTool("claude", claudeConfig, fakeRun as any)
    const context = { ...fakeContext("session-start-summary-dir"), directory: dir, worktree: dir }
    const reply = await startTool.execute({ prompt: "hello" }, context as any)

    expect(reply).toContain("new file: delegate-made-this.md")
  })

  it("returns an actionable message instead of calling the CLI when the cached agent is restrictive", async () => {
    let startCalled = false
    const fakeRun = async () => {
      startCalled = true
      return { finalText: "hi", externalId: undefined, stderrText: "" }
    }

    const startTool = makeStartTool("claude", claudeConfig, fakeRun as any)
    const context = fakeContext("session-start-restrictive-agent")
    setSessionAgent("session-start-restrictive-agent", "plan")

    const reply = await startTool.execute({ prompt: "hello" }, context as any)

    expect(startCalled).toBe(false)
    expect(reply).toContain("plan")
    expect(reply).toContain("/opencode")
  })
})

describe("makeReplyTool", () => {
  it("rejects before calling the CLI when claude_reply is used without claude_start", async () => {
    let replyCalled = false
    const fakeReplyRun = async () => {
      replyCalled = true
      return { finalText: "hello again", externalId: undefined, stderrText: "" }
    }

    const replyTool = makeReplyTool("claude", claudeConfig, fakeReplyRun as any)
    const context = fakeContext("session-without-start")

    await expect(replyTool.execute({ prompt: "follow up" }, context as any)).rejects.toThrow(
      "No active claude session for this conversation. Call claude_start first.",
    )
    expect(replyCalled).toBe(false)
  })

  it("succeeds after claude_start even though the parser never reported an externalId", async () => {
    const fakeStartRun = async () => ({ finalText: "hi", externalId: undefined, stderrText: "" })
    const fakeReplyRun = async () => ({ finalText: "hello again", externalId: undefined, stderrText: "" })

    const startTool = makeStartTool("claude", claudeConfig, fakeStartRun as any)
    const replyTool = makeReplyTool("claude", claudeConfig, fakeReplyRun as any)
    const context = fakeContext("session-b")

    await startTool.execute({ prompt: "hello" }, context as any)

    const reply = await replyTool.execute({ prompt: "follow up" }, context as any)
    expect(reply).toContain("hello again")
  })

  it("keeps concurrent sessions on their own delegate threads", async () => {
    const fakeStartRun = async (options: { args: string[] }) => ({
      finalText: "started",
      externalId: options.args.includes("first task") ? "thread-one" : "thread-two",
      stderrText: "",
    })
    const replyArgs: string[][] = []
    const fakeReplyRun = async (options: { args: string[] }) => {
      replyArgs.push(options.args)
      return { finalText: "replied", externalId: undefined, stderrText: "" }
    }

    const startTool = makeStartTool("claude", claudeConfig, fakeStartRun as any)
    const replyTool = makeReplyTool("claude", claudeConfig, fakeReplyRun as any)
    const firstContext = fakeContext("concurrent-session-one")
    const secondContext = fakeContext("concurrent-session-two")

    await Promise.all([
      startTool.execute({ prompt: "first task" }, firstContext as any),
      startTool.execute({ prompt: "second task" }, secondContext as any),
    ])
    await Promise.all([
      replyTool.execute({ prompt: "first reply" }, firstContext as any),
      replyTool.execute({ prompt: "second reply" }, secondContext as any),
    ])

    expect(replyArgs).toContainEqual(["--resume", "thread-one", "--", "first reply"])
    expect(replyArgs).toContainEqual(["--resume", "thread-two", "--", "second reply"])
  })

  it("returns an actionable message instead of calling the CLI when the cached agent is restrictive", async () => {
    const fakeStartRun = async () => ({ finalText: "hi", externalId: undefined, stderrText: "" })
    let replyCalled = false
    const fakeReplyRun = async () => {
      replyCalled = true
      return { finalText: "hello again", externalId: undefined, stderrText: "" }
    }

    const startTool = makeStartTool("claude", claudeConfig, fakeStartRun as any)
    const replyTool = makeReplyTool("claude", claudeConfig, fakeReplyRun as any)
    const context = fakeContext("session-c")

    await startTool.execute({ prompt: "hello" }, context as any)
    setSessionAgent("session-c", "plan")

    const reply = await replyTool.execute({ prompt: "follow up" }, context as any)

    expect(replyCalled).toBe(false)
    expect(reply).toContain("plan")
    expect(reply).toContain("/opencode")
  })

  it("returns an actionable message after chat.message caches a restrictive agent", async () => {
    const fakeStartRun = async () => ({ finalText: "hi", externalId: undefined, stderrText: "" })
    let replyCalled = false
    const fakeReplyRun = async () => {
      replyCalled = true
      return { finalText: "hello again", externalId: undefined, stderrText: "" }
    }

    const startTool = makeStartTool("claude", claudeConfig, fakeStartRun as any)
    const replyTool = makeReplyTool("claude", claudeConfig, fakeReplyRun as any)
    const context = fakeContext("session-chat-message-plan")

    await startTool.execute({ prompt: "hello" }, context as any)
    await makeChatMessage()({ sessionID: context.sessionID, agent: "plan" }, { parts: [] })

    const reply = await replyTool.execute({ prompt: "follow up" }, context as any)

    expect(replyCalled).toBe(false)
    expect(reply).toContain("plan")
    expect(reply).toContain("/opencode")
  })

  it("passes a default 10-minute timeout and the context abort signal to the run", async () => {
    const fakeStartRun = async () => ({ finalText: "hi", externalId: undefined, stderrText: "" })
    let captured: { timeoutMs?: number; signal?: AbortSignal } = {}
    const fakeReplyRun = async (options: { timeoutMs?: number; signal?: AbortSignal }) => {
      captured = options
      return { finalText: "hello again", externalId: undefined, stderrText: "" }
    }

    const startTool = makeStartTool("claude", claudeConfig, fakeStartRun as any)
    const replyTool = makeReplyTool("claude", claudeConfig, fakeReplyRun as any)
    const context = fakeContext("session-reply-timeout")

    await startTool.execute({ prompt: "hello" }, context as any)
    await replyTool.execute({ prompt: "follow up" }, context as any)

    expect(captured.timeoutMs).toBe(10 * 60 * 1000)
    expect(captured.signal).toBe(context.abort)
  })

  it("prefers the delegate config timeoutMs over the default", async () => {
    const fakeStartRun = async () => ({ finalText: "hi", externalId: undefined, stderrText: "" })
    let captured: { timeoutMs?: number } = {}
    const fakeReplyRun = async (options: { timeoutMs?: number }) => {
      captured = options
      return { finalText: "hello again", externalId: undefined, stderrText: "" }
    }

    const startTool = makeStartTool("claude", claudeConfig, fakeStartRun as any)
    const replyTool = makeReplyTool("claude", { ...claudeConfig, timeoutMs: 45000 }, fakeReplyRun as any)
    const context = fakeContext("session-reply-timeout-override")

    await startTool.execute({ prompt: "hello" }, context as any)
    await replyTool.execute({ prompt: "follow up" }, context as any)

    expect(captured.timeoutMs).toBe(45000)
  })

  it("runs the delegate CLI in the session project directory from the tool context", async () => {
    const fakeStartRun = async () => ({ finalText: "hi", externalId: undefined, stderrText: "" })
    let captured: { cwd?: string } = {}
    const fakeReplyRun = async (options: { cwd?: string }) => {
      captured = options
      return { finalText: "hello again", externalId: undefined, stderrText: "" }
    }

    const startTool = makeStartTool("claude", claudeConfig, fakeStartRun as any)
    const replyTool = makeReplyTool("claude", claudeConfig, fakeReplyRun as any)
    const context = { ...fakeContext("session-reply-cwd"), directory: "/tmp/session-project-dir" }

    await startTool.execute({ prompt: "hello" }, context as any)
    await replyTool.execute({ prompt: "follow up" }, context as any)

    expect(captured.cwd).toBe("/tmp/session-project-dir")
  })
})
