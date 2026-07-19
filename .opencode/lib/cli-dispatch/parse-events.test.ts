// .opencode/lib/cli-dispatch/parse-events.test.ts
import { test, expect } from "bun:test"
import { parseCodexLine, parseClaudeLine } from "./parse-events"

test("codex: thread.started extracts externalId", () => {
  const line = '{"type":"thread.started","thread_id":"019f7a1b-3d47-7551-87fb-db4e5abc58d6"}'
  expect(parseCodexLine(line).externalId).toBe("019f7a1b-3d47-7551-87fb-db4e5abc58d6")
})

test("codex: item.completed agent_message extracts finalText", () => {
  const line = '{"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"PONG"}}'
  const parsed = parseCodexLine(line)
  expect(parsed.finalText).toBe("PONG")
  expect(parsed.progressText).toBe("PONG")
})

test("codex: item.started command_execution produces progress text only", () => {
  const line =
    '{"type":"item.started","item":{"id":"item_1","type":"command_execution","command":"ls -la","status":"in_progress"}}'
  const parsed = parseCodexLine(line)
  expect(parsed.progressText).toContain("ls -la")
  expect(parsed.finalText).toBeUndefined()
})

test("codex: turn.started produces no progress or final text", () => {
  expect(parseCodexLine('{"type":"turn.started"}')).toEqual({})
})

test("codex: malformed line falls back to raw progress text", () => {
  expect(parseCodexLine("not json")).toEqual({ progressText: "not json" })
})

test("claude: assistant event with text content produces progress text", () => {
  const line = JSON.stringify({
    type: "assistant",
    message: { content: [{ type: "text", text: "PONG" }] },
  })
  const parsed = parseClaudeLine(line)
  expect(parsed.progressText).toBe("PONG")
  expect(parsed.finalText).toBeUndefined()
})

test("claude: result event extracts finalText", () => {
  const line = JSON.stringify({ type: "result", subtype: "success", is_error: false, result: "PONG" })
  expect(parseClaudeLine(line).finalText).toBe("PONG")
})

test("claude: system event produces no text", () => {
  const line = JSON.stringify({ type: "system", subtype: "init" })
  expect(parseClaudeLine(line)).toEqual({})
})
