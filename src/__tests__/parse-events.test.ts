import { describe, it, expect } from "bun:test"
import { getParser } from "../parse-events"

describe("getParser", () => {
  const malformedEvents = [
    ["invalid JSON", "{bad"],
    ["null JSON value", "null"],
    ["array JSON value", "[]"],
    ["event with required fields missing", '{"type":"assistant"}'],
  ]

  for (const parserName of ["claude", "codex"] as const) {
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

    it("extracts the session id present on every line", () => {
      const line = JSON.stringify({ type: "step_start", sessionID: "ses_123" })
      expect(parser(line).externalId).toBe("ses_123")
    })

    it("accumulates a single text event as final text to append", () => {
      const line = JSON.stringify({
        type: "text",
        sessionID: "ses_123",
        part: { type: "text", text: "chunk one" },
      })
      const result = parser(line)
      expect(result.externalId).toBe("ses_123")
      expect(result.finalText).toBe("chunk one")
      expect(result.appendFinalText).toBe(true)
    })

    it("returns each text event's chunk in order for the caller to accumulate", () => {
      const chunks = [
        JSON.stringify({ type: "text", sessionID: "ses_1", part: { type: "text", text: "first" } }),
        JSON.stringify({ type: "text", sessionID: "ses_1", part: { type: "text", text: "second" } }),
      ].map((line) => parser(line))
      expect(chunks.map((c) => c.finalText)).toEqual(["first", "second"])
      expect(chunks.every((c) => c.appendFinalText)).toBe(true)
    })

    it("returns progress for non-JSON lines", () => {
      expect(parser("plain output").progressText).toBe("plain output")
    })

    it("ignores unrelated event types but still reports the session id", () => {
      const line = JSON.stringify({ type: "tool_use", sessionID: "ses_9", part: { type: "tool" } })
      const result = parser(line)
      expect(result.externalId).toBe("ses_9")
      expect(result.finalText).toBeUndefined()
      expect(result.progressText).toBeUndefined()
    })

    it("returns an empty result for JSON values that are not objects", () => {
      expect(parser("null")).toEqual({})
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
