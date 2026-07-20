import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"
import { snapshotWorktree, buildChangeSummary, makeStartTool, makeReplyTool } from "../delegate-tools"
import type { DelegateConfig } from "../config"
import { getActiveDelegate, setSessionAgent } from "../session-store"

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
})

describe("makeReplyTool", () => {
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
})
