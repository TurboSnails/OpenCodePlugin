import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"
import { getCurrentModel } from "../claude-code-adapter/current-model"

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "cli-dispatch-transcript-test-"))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe("getCurrentModel", () => {
  it("returns undefined when the transcript file doesn't exist", () => {
    expect(getCurrentModel(join(dir, "nonexistent.jsonl"))).toBeUndefined()
  })

  it("returns undefined when no assistant line has a model yet", () => {
    const path = join(dir, "transcript.jsonl")
    writeFileSync(path, `${JSON.stringify({ type: "queue-operation", operation: "enqueue" })}\n`)
    expect(getCurrentModel(path)).toBeUndefined()
  })

  it("extracts the model from a single assistant line", () => {
    const path = join(dir, "transcript.jsonl")
    writeFileSync(path, `${JSON.stringify({ type: "assistant", message: { model: "claude-sonnet-5" } })}\n`)
    expect(getCurrentModel(path)).toBe("claude-sonnet-5")
  })

  it("returns the model from the last assistant line when there are several", () => {
    const path = join(dir, "transcript.jsonl")
    const lines = [
      { type: "assistant", message: { model: "claude-sonnet-5" } },
      { type: "queue-operation", operation: "enqueue" },
      { type: "assistant", message: { model: "claude-opus-4-8" } },
    ]
    writeFileSync(path, lines.map((l) => JSON.stringify(l)).join("\n") + "\n")
    expect(getCurrentModel(path)).toBe("claude-opus-4-8")
  })

  it("skips malformed lines without throwing", () => {
    const path = join(dir, "transcript.jsonl")
    writeFileSync(path, `not json\n${JSON.stringify({ type: "assistant", message: { model: "claude-sonnet-5" } })}\n`)
    expect(() => getCurrentModel(path)).not.toThrow()
    expect(getCurrentModel(path)).toBe("claude-sonnet-5")
  })
})
