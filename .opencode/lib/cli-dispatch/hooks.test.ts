import { test, expect, beforeEach } from "bun:test"
import { makeSystemTransform, makeChatMessage } from "./hooks"
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
