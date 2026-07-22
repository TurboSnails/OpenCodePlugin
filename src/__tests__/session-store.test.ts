import { describe, it, expect, beforeEach } from "bun:test"
import { getActiveDelegate, setActiveDelegate, clearActiveDelegate, getSessionAgent, setSessionAgent, getSessionModel, setSessionModel, beginDelegateStart, setActiveDelegateIfLatest, memoryDelegateStore } from "../session-store"

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
