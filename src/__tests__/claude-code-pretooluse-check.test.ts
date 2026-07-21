import { describe, it, expect } from "bun:test"
import { checkPreToolUse } from "../claude-code-adapter/pretooluse-check"
import { GENERATED_MARKER } from "../commands"

describe("checkPreToolUse", () => {
  it("rejects a codex_start prompt containing the generated-command marker", () => {
    const verdict = checkPreToolUse(
      { tool_name: "mcp__cli-dispatch__codex_start", tool_input: { prompt: `${GENERATED_MARKER}\nDelegate this conversation.` } },
      ["codex", "opencode"],
    )
    expect(verdict.block).toBe(true)
    if (verdict.block) expect(verdict.reason).toContain("prompt")
  })

  it("rejects an opencode_reply prompt containing the marker", () => {
    const verdict = checkPreToolUse(
      { tool_name: "mcp__cli-dispatch__opencode_reply", tool_input: { prompt: `some text\n${GENERATED_MARKER}\nmore text` } },
      ["codex", "opencode"],
    )
    expect(verdict.block).toBe(true)
  })

  it("allows an ordinary user prompt through", () => {
    const verdict = checkPreToolUse(
      { tool_name: "mcp__cli-dispatch__codex_start", tool_input: { prompt: "please fix the failing test" } },
      ["codex", "opencode"],
    )
    expect(verdict.block).toBe(false)
  })

  it("ignores tools that aren't configured delegate tools", () => {
    const verdict = checkPreToolUse(
      { tool_name: "Bash", tool_input: { command: `echo ${GENERATED_MARKER}` } },
      ["codex", "opencode"],
    )
    expect(verdict.block).toBe(false)
  })

  it("ignores an unrelated mcp tool even if it contains the marker", () => {
    const verdict = checkPreToolUse(
      { tool_name: "mcp__other-server__some_tool", tool_input: { prompt: GENERATED_MARKER } },
      ["codex", "opencode"],
    )
    expect(verdict.block).toBe(false)
  })
})
