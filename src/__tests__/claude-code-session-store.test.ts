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
