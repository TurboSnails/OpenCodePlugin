import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { writeFileSync, mkdtempSync, rmSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"
import { decideUserPromptSubmit } from "../claude-code-adapter/userpromptsubmit-logic"
import { setActiveDelegate, clearActiveDelegate, getActiveDelegate } from "../claude-code-adapter/session-store"
import type { ClaudeCodeAdapterConfig } from "../claude-code-adapter/config"

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "cli-dispatch-ups-test-"))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

const baseConfig: ClaudeCodeAdapterConfig = {
  delegates: {
    codex: { binary: "codex", parser: "codex", startArgs: ["{prompt}"], replyArgs: ["{externalId}", "{prompt}"] },
    opencode: { binary: "opencode", parser: "opencode", startArgs: ["{prompt}"], replyArgs: ["{externalId}", "{prompt}"] },
  },
}

function transcriptWithModel(model: string): string {
  const path = join(dir, `${Math.random()}.jsonl`)
  writeFileSync(path, `${JSON.stringify({ type: "assistant", message: { model } })}\n`)
  return path
}

function emptyTranscript(): string {
  return join(dir, "nonexistent.jsonl")
}

describe("decideUserPromptSubmit: home command", () => {
  it("clears an active delegation and blocks with a note", () => {
    setActiveDelegate("ups-session-1", "codex", "thread-1")
    const action = decideUserPromptSubmit(
      { session_id: "ups-session-1", prompt: "/cc", transcript_path: emptyTranscript() },
      baseConfig,
    )
    expect(action.kind).toBe("block")
    if (action.kind === "block") expect(action.reason).toContain("Cleared the active codex delegation")
    expect(getActiveDelegate("ups-session-1")).toBeUndefined()
  })

  it("reports no active delegation as a safe no-op", () => {
    const action = decideUserPromptSubmit(
      { session_id: "ups-session-2", prompt: "/cc", transcript_path: emptyTranscript() },
      baseConfig,
    )
    expect(action.kind).toBe("block")
    if (action.kind === "block") expect(action.reason).toContain("No CLI delegation was active")
  })

  it("recognizes /cc with trailing text", () => {
    setActiveDelegate("ups-session-3", "opencode", "ses-1")
    const action = decideUserPromptSubmit(
      { session_id: "ups-session-3", prompt: "/cc thanks", transcript_path: emptyTranscript() },
      baseConfig,
    )
    expect(action.kind).toBe("block")
    expect(getActiveDelegate("ups-session-3")).toBeUndefined()
  })
})

describe("decideUserPromptSubmit: delegate-start commands", () => {
  it("allows a delegate-start command through when no verifiedModels is configured", () => {
    const action = decideUserPromptSubmit(
      { session_id: "ups-session-4", prompt: "/codex fix the bug", transcript_path: transcriptWithModel("gpt-5") },
      baseConfig,
    )
    expect(action.kind).toBe("none")
  })

  it("allows a delegate-start command through when the model matches the allow-list", () => {
    const config: ClaudeCodeAdapterConfig = { ...baseConfig, verifiedModels: ["claude-*"] }
    const action = decideUserPromptSubmit(
      { session_id: "ups-session-5", prompt: "/codex fix the bug", transcript_path: transcriptWithModel("claude-sonnet-5") },
      config,
    )
    expect(action.kind).toBe("none")
  })

  it("blocks a delegate-start command when the model matches no allow-list entry", () => {
    const config: ClaudeCodeAdapterConfig = { ...baseConfig, verifiedModels: ["claude-*"] }
    const action = decideUserPromptSubmit(
      { session_id: "ups-session-6", prompt: "/opencode fix the bug", transcript_path: transcriptWithModel("gpt-5") },
      config,
    )
    expect(action.kind).toBe("block")
    if (action.kind === "block") {
      expect(action.reason).toContain("gpt-5")
      expect(action.reason).toContain("not on the verified-models allow-list")
    }
  })

  it("fails open when no model is known yet for the session", () => {
    const config: ClaudeCodeAdapterConfig = { ...baseConfig, verifiedModels: ["claude-*"] }
    const action = decideUserPromptSubmit(
      { session_id: "ups-session-7", prompt: "/codex fix the bug", transcript_path: emptyTranscript() },
      config,
    )
    expect(action.kind).toBe("none")
  })
})

describe("decideUserPromptSubmit: sticky follow-up", () => {
  it("injects the routing rule with the mcp-namespaced reply tool name when a delegation is active", () => {
    setActiveDelegate("ups-session-8", "codex", "thread-2")
    const action = decideUserPromptSubmit(
      { session_id: "ups-session-8", prompt: "also add a test for it", transcript_path: emptyTranscript() },
      baseConfig,
    )
    expect(action.kind).toBe("inject")
    if (action.kind === "inject") {
      expect(action.context).toContain("mcp__cli-dispatch__codex_reply")
      expect(action.context).toContain("codex CLI")
    }
  })

  it("does nothing when there's no active delegation and no recognized command", () => {
    const action = decideUserPromptSubmit(
      { session_id: "ups-session-9", prompt: "what's 2+2?", transcript_path: emptyTranscript() },
      baseConfig,
    )
    expect(action.kind).toBe("none")
  })
})
