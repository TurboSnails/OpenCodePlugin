// .opencode/lib/cli-dispatch/parse-events.test.ts
import { test, expect } from "bun:test"
import {
  parseCodexLine,
  parseClaudeLine,
  parseKimiLine,
  parseKimiStderrForSessionId,
} from "./parse-events"

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

test("kimi: assistant line extracts finalText from text content, ignoring think blocks", () => {
  const line =
    '{"role":"assistant","content":[{"type":"think","think":"reasoning here"},{"type":"text","text":"PONG"}]}'
  const parsed = parseKimiLine(line)
  expect(parsed.finalText).toBe("PONG")
})

test("kimi: think-only line (no text yet) surfaces think content as progress, no finalText", () => {
  const line = '{"role":"assistant","content":[{"type":"think","think":"still thinking"}]}'
  const parsed = parseKimiLine(line)
  expect(parsed.finalText).toBeUndefined()
  expect(parsed.progressText).toBe("still thinking")
})

test("kimi: session id parsed from stderr resume hint", () => {
  const stderr = "\nTo resume this session: kimi -r bb924c56-e36d-4f21-a357-e6577bd8d58a\n"
  expect(parseKimiStderrForSessionId(stderr)).toBe("bb924c56-e36d-4f21-a357-e6577bd8d58a")
})

test("kimi: stderr with no resume hint returns undefined", () => {
  expect(parseKimiStderrForSessionId("some other output\n")).toBeUndefined()
})
