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
