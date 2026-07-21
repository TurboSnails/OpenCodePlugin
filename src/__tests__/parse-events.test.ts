import { describe, it, expect } from "bun:test"
import { getParser } from "../parse-events"

describe("getParser", () => {
  const malformedEvents = [
    ["invalid JSON", "{bad"],
    ["null JSON value", "null"],
    ["array JSON value", "[]"],
    ["event with required fields missing", '{"type":"assistant"}'],
  ]

  for (const parserName of ["claude", "codex", "opencode"] as const) {
    const parser = getParser(parserName)

    for (const [description, line] of malformedEvents) {
      it(`does not throw for ${description} in the ${parserName} parser`, () => {
        expect(() => parser(line)).not.toThrow()
      })
    }
  }

  describe("claude parser", () => {
    const parser = getParser("claude")

    it("parses assistant messages as progress", () => {
      const line = JSON.stringify({
        type: "assistant",
        message: {
          content: [{ type: "text", text: "I'm working on..." }],
        },
      })
      const result = parser(line)
      expect(result.progressText).toBe("I'm working on...")
      expect(result.finalText).toBeUndefined()
    })

    it("parses result messages as final text", () => {
      const line = JSON.stringify({
        type: "result",
        result: "Done!",
      })
      const result = parser(line)
      expect(result.finalText).toBe("Done!")
    })

    it("returns progress for non-JSON lines", () => {
      const result = parser("plain text output")
      expect(result.progressText).toBe("plain text output")
    })
  })

  describe("codex parser", () => {
    const parser = getParser("codex")

    it("parses thread.started for external ID", () => {
      const line = JSON.stringify({
        type: "thread.started",
        thread_id: "thread-123",
      })
      const result = parser(line)
      expect(result.externalId).toBe("thread-123")
    })

    it("parses agent_message as final text", () => {
      const line = JSON.stringify({
        type: "item.completed",
        item: {
          type: "agent_message",
          text: "Here's the result",
        },
      })
      const result = parser(line)
      expect(result.finalText).toBe("Here's the result")
    })

    it("parses command_execution as progress", () => {
      const line = JSON.stringify({
        type: "item.started",
        item: {
          type: "command_execution",
          command: "npm test",
        },
      })
      const result = parser(line)
      expect(result.progressText).toBe("running: npm test")
    })
  })

  describe("opencode parser", () => {
    const parser = getParser("opencode")

    it("extracts the session id from any event line", () => {
      const line = JSON.stringify({
        type: "step_start",
        sessionID: "ses_abc123",
        part: { type: "step-start" },
      })
      const result = parser(line)
      expect(result.externalId).toBe("ses_abc123")
    })

    it("accumulates text events as final text, in order", () => {
      const first = parser(JSON.stringify({ type: "text", sessionID: "ses_1", part: { type: "text", text: "Hello" } }))
      expect(first.finalText).toBe("Hello")
      expect(first.appendFinalText).toBe(true)

      const second = parser(JSON.stringify({ type: "text", sessionID: "ses_1", part: { type: "text", text: "World" } }))
      expect(second.finalText).toBe("World")
      expect(second.appendFinalText).toBe(true)
    })

    it("surfaces text events as progress too", () => {
      const line = JSON.stringify({ type: "text", sessionID: "ses_1", part: { type: "text", text: "working..." } })
      const result = parser(line)
      expect(result.progressText).toBe("working...")
    })

    it("ignores unrelated event types", () => {
      const line = JSON.stringify({ type: "step_finish", sessionID: "ses_1", part: { type: "step-finish" } })
      const result = parser(line)
      expect(result.finalText).toBeUndefined()
      expect(result.progressText).toBeUndefined()
    })
  })

  describe("raw parser", () => {
    const parser = getParser("raw")

    it("returns each line as progress plus a final-text chunk to append", () => {
      const result = parser("any output line")
      expect(result.progressText).toBe("any output line")
      expect(result.finalText).toBe("any output line")
      expect(result.appendFinalText).toBe(true)
    })
  })
})
