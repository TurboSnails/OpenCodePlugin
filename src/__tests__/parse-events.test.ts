import { describe, it, expect } from "bun:test"
import { getParser } from "../parse-events"

describe("getParser", () => {
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

  describe("raw parser", () => {
    const parser = getParser("raw")

    it("returns line as both progress and final text", () => {
      const result = parser("any output line")
      expect(result.progressText).toBe("any output line")
      expect(result.finalText).toBe("any output line")
    })
  })
})
