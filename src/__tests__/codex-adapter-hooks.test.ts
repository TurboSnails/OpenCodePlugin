import { describe, it, expect } from "bun:test"
import { handleUserPromptSubmit } from "../codex-adapter/hooks/user-prompt-submit"
import { handlePreToolUse } from "../codex-adapter/hooks/pre-tool-use"
import { handleSessionEnd } from "../codex-adapter/hooks/session-end"
import { writeCurrentSession, readCurrentSession, codexFileDelegateStore } from "../codex-adapter/session-store"
import { GENERATED_MARKER } from "../policy"
import { mkdtempSync, rmSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"

describe("handleUserPromptSubmit", () => {
  it("records the current session id", () => {
    const dir = mkdtempSync(join(tmpdir(), "codex-hooks-"))
    handleUserPromptSubmit({ session_id: "sess-1", prompt: "hello" }, dir)
    expect(readCurrentSession(dir)).toBe("sess-1")
    expect(codexFileDelegateStore(dir).getActiveDelegate("sess-1")).toBeUndefined()
    rmSync(dir, { recursive: true, force: true })
  })

  it("returns sticky context when a delegate is active", () => {
    const dir = mkdtempSync(join(tmpdir(), "codex-hooks-"))
    const store = codexFileDelegateStore(dir)
    store.setActiveDelegate("sess-1", "claude", "ext-1")
    const out = handleUserPromptSubmit({ session_id: "sess-1", prompt: "hello" }, dir)
    expect(out.hookSpecificOutput?.additionalContext).toContain("claude_reply")
    rmSync(dir, { recursive: true, force: true })
  })

  it("clears delegation on exit keyword", () => {
    const dir = mkdtempSync(join(tmpdir(), "codex-hooks-"))
    const store = codexFileDelegateStore(dir)
    store.setActiveDelegate("sess-1", "claude", "ext-1")
    const out = handleUserPromptSubmit({ session_id: "sess-1", prompt: "/prompts:opencode" }, dir)
    expect(out.systemMessage).toContain("Cleared")
    expect(store.getActiveDelegate("sess-1")).toBeUndefined()
    rmSync(dir, { recursive: true, force: true })
  })

  it("blocks prompts containing the generated marker", () => {
    const dir = mkdtempSync(join(tmpdir(), "codex-hooks-"))
    const out = handleUserPromptSubmit({ session_id: "sess-1", prompt: `hello ${GENERATED_MARKER}` }, dir)
    expect(out.decision).toBe("block")
    rmSync(dir, { recursive: true, force: true })
  })
})

describe("handlePreToolUse", () => {
  it("allows unrelated tools", () => {
    expect(handlePreToolUse({ tool_name: "Bash", tool_input: {} })).toBeUndefined()
  })

  it("blocks delegate tools with marker in prompt", () => {
    const out = handlePreToolUse({
      tool_name: "mcp__cli_dispatch__claude_start",
      tool_input: { prompt: GENERATED_MARKER },
    })
    expect(out?.hookSpecificOutput?.permissionDecision).toBe("deny")
  })

  it("blocks unverified model", () => {
    const out = handlePreToolUse({
      tool_name: "mcp__cli_dispatch__claude_start",
      tool_input: { prompt: "hello" },
      model: "gpt-5.6-sol",
    }, { delegates: { claude: { binary: "c", parser: "raw", startArgs: ["--", "{prompt}"], replyArgs: ["--", "{prompt}"] } }, verifiedModels: ["other-*"] })
    expect(out?.hookSpecificOutput?.permissionDecision).toBe("deny")
  })
})

describe("handleSessionEnd", () => {
  it("clears active delegate", () => {
    const dir = mkdtempSync(join(tmpdir(), "codex-hooks-"))
    const store = codexFileDelegateStore(dir)
    store.setActiveDelegate("sess-1", "claude", "ext-1")
    handleSessionEnd({ session_id: "sess-1" }, dir)
    expect(store.getActiveDelegate("sess-1")).toBeUndefined()
    rmSync(dir, { recursive: true, force: true })
  })
})
