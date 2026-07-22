import { describe, it, expect, beforeEach } from "bun:test"
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, rmSync } from "fs"
import { tmpdir } from "os"
import { join, dirname } from "path"
import { getActiveDelegate, setActiveDelegate, clearActiveDelegate, getSessionAgent, setSessionAgent, getSessionModel, setSessionModel, beginDelegateStart, setActiveDelegateIfLatest, memoryDelegateStore, takeSessionNotice, defaultStatePath } from "../session-store"

// The default state file lives in tmpdir and survives across test runs, so
// leftover entries would hydrate into tests that expect an empty store.
beforeEach(() => {
  rmSync(defaultStatePath(), { force: true })
})

describe("session-store", () => {
  beforeEach(() => {
    // Clear all sessions before each test
    clearActiveDelegate("test-session-1")
    clearActiveDelegate("test-session-2")
  })

  it("returns undefined for non-existent session", () => {
    const result = getActiveDelegate("nonexistent")
    expect(result).toBeUndefined()
  })

  it("sets and gets active delegate", () => {
    setActiveDelegate("session-1", "claude", "claude-session-123")
    const result = getActiveDelegate("session-1")
    expect(result).toBeDefined()
    expect(result?.delegate).toBe("claude")
    expect(result?.externalId).toBe("claude-session-123")
  })

  it("clears active delegate", () => {
    setActiveDelegate("session-1", "codex", "codex-thread-456")
    clearActiveDelegate("session-1")
    const result = getActiveDelegate("session-1")
    expect(result).toBeUndefined()
  })

  it("supports multiple independent sessions", () => {
    setActiveDelegate("session-1", "claude", "claude-123")
    setActiveDelegate("session-2", "codex", "codex-456")

    const result1 = getActiveDelegate("session-1")
    const result2 = getActiveDelegate("session-2")

    expect(result1?.delegate).toBe("claude")
    expect(result2?.delegate).toBe("codex")
  })

  it("overwrites existing delegate for same session", () => {
    setActiveDelegate("session-1", "claude", "claude-123")
    setActiveDelegate("session-1", "codex", "codex-456")

    const result = getActiveDelegate("session-1")
    expect(result?.delegate).toBe("codex")
    expect(result?.externalId).toBe("codex-456")
  })
})

describe("session agent cache", () => {
  it("returns undefined for a session with no cached agent", () => {
    expect(getSessionAgent("agent-nonexistent")).toBeUndefined()
  })

  it("sets and gets the cached agent for a session", () => {
    setSessionAgent("agent-session-1", "plan")
    expect(getSessionAgent("agent-session-1")).toBe("plan")
  })

  it("overwrites the cached agent for the same session", () => {
    setSessionAgent("agent-session-2", "plan")
    setSessionAgent("agent-session-2", "build")
    expect(getSessionAgent("agent-session-2")).toBe("build")
  })
})

describe("session model cache", () => {
  it("returns undefined for a session with no cached model", () => {
    expect(getSessionModel("model-nonexistent")).toBeUndefined()
  })

  it("sets and gets the cached model for a session", () => {
    setSessionModel("model-session-1", { providerID: "anthropic", modelID: "claude-sonnet-4-5" })
    expect(getSessionModel("model-session-1")).toEqual({ providerID: "anthropic", modelID: "claude-sonnet-4-5" })
  })

  it("overwrites the cached model for the same session", () => {
    setSessionModel("model-session-2", { providerID: "anthropic", modelID: "claude-sonnet-4-5" })
    setSessionModel("model-session-2", { providerID: "minimax-cn", modelID: "MiniMax-M2.5" })
    expect(getSessionModel("model-session-2")).toEqual({ providerID: "minimax-cn", modelID: "MiniMax-M2.5" })
  })
})

describe("setActiveDelegateIfLatest (memory)", () => {
  it("registers when the sequence is current and rejects an older sequence", () => {
    const session = "mem-latest-1"
    const first = beginDelegateStart(session)
    const second = beginDelegateStart(session)
    expect(setActiveDelegateIfLatest(session, "codex", "ext-old", first)).toBe(false)
    expect(getActiveDelegate(session)).toBeUndefined()
    expect(setActiveDelegateIfLatest(session, "codex", "ext-new", second)).toBe(true)
    expect(getActiveDelegate(session)).toEqual({ delegate: "codex", externalId: "ext-new" })
  })

  it("memoryDelegateStore implements the DelegateStore interface", () => {
    const session = "mem-latest-2"
    const seq = memoryDelegateStore.beginDelegateStart(session)
    expect(memoryDelegateStore.setActiveDelegateIfLatest(session, "claude", "ext-1", seq)).toBe(true)
    expect(memoryDelegateStore.getActiveDelegate(session)).toEqual({ delegate: "claude", externalId: "ext-1" })
    memoryDelegateStore.clearActiveDelegate(session)
    expect(memoryDelegateStore.getActiveDelegate(session)).toBeUndefined()
  })
})

describe("state persistence (OpenCode memory store)", () => {
  let statePath: string
  beforeEach(() => {
    statePath = join(mkdtempSync(join(tmpdir(), "cli-dispatch-oc-state-")), "active-delegations.json")
  })

  it("persists active delegations to the state file on set", () => {
    setActiveDelegate("persist-1", "codex", "ext-1", statePath)
    const onDisk = JSON.parse(readFileSync(statePath, "utf-8"))
    expect(onDisk["persist-1"].delegate).toBe("codex")
    expect(onDisk["persist-1"].externalId).toBe("ext-1")
    expect(typeof onDisk["persist-1"].updatedAt).toBe("number")
  })

  it("hydrates a fresh entry from the file on first access and announces the restore once", () => {
    mkdirSync(dirname(statePath), { recursive: true })
    writeFileSync(statePath, JSON.stringify({ "persist-2": { delegate: "claude", externalId: "ext-2", updatedAt: Date.now() } }), "utf-8")
    expect(getActiveDelegate("persist-2", statePath)).toEqual({ delegate: "claude", externalId: "ext-2" })
    expect(takeSessionNotice("persist-2")).toEqual({ kind: "restored", delegate: "claude" })
    expect(takeSessionNotice("persist-2")).toBeUndefined()
  })

  it("treats a stale entry as lost: no hydration, explicit lost notice, entry removed", () => {
    mkdirSync(dirname(statePath), { recursive: true })
    writeFileSync(statePath, JSON.stringify({ "persist-3": { delegate: "codex", externalId: "ext-3", updatedAt: Date.now() - 25 * 60 * 60 * 1000 } }), "utf-8")
    expect(getActiveDelegate("persist-3", statePath)).toBeUndefined()
    expect(takeSessionNotice("persist-3")).toEqual({ kind: "lost" })
    const onDisk = JSON.parse(readFileSync(statePath, "utf-8"))
    expect(onDisk["persist-3"]).toBeUndefined()
  })

  it("clearActiveDelegate removes the persisted entry", () => {
    setActiveDelegate("persist-4", "codex", "ext-4", statePath)
    clearActiveDelegate("persist-4", statePath)
    const onDisk = JSON.parse(readFileSync(statePath, "utf-8"))
    expect(onDisk["persist-4"]).toBeUndefined()
  })
})
