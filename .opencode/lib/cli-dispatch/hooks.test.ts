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
