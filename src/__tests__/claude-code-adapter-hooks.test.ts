import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"
import { GENERATED_MARKER } from "../commands"
import { checkPreToolUse, mcpToolName } from "../claude-code-adapter/pretooluse-check"
import { decideUserPromptSubmit } from "../claude-code-adapter/userpromptsubmit-logic"
import { setActiveDelegate, getActiveDelegate } from "../claude-code-adapter/session-store"
import type { ClaudeCodeAdapterConfig } from "../claude-code-adapter/config"

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "cli-dispatch-cc-hooks-test-"))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

const config: ClaudeCodeAdapterConfig = {
  delegates: {
    codex: {
      binary: "codex",
      parser: "codex",
      startArgs: ["exec", "--", "{prompt}"],
      replyArgs: ["exec", "resume", "{externalId}", "--", "{prompt}"],
    },
    opencode: {
      binary: "opencode",
      parser: "opencode",
      startArgs: ["run", "--format", "json", "{prompt}"],
      replyArgs: ["run", "--format", "json", "-s", "{externalId}", "-c", "{prompt}"],
    },
  },
  verifiedModels: ["claude-*"],
}

function transcriptWithModel(model: string): string {
  const path = join(dir, `transcript-${model}.jsonl`)
  writeFileSync(path, JSON.stringify({ type: "assistant", message: { model } }) + "\n")
  return path
}

describe("checkPreToolUse", () => {
  it("blocks a delegate tool call whose prompt contains the command template marker", () => {
    const verdict = checkPreToolUse(
      { tool_name: "mcp__cli-dispatch__codex_start", tool_input: { prompt: `do the thing\n${GENERATED_MARKER}\n...` } },
      config,
    )
    expect(verdict.block).toBe(true)
    if (verdict.block) expect(verdict.reason).toContain("mcp__cli-dispatch__codex_start")
  })

  it("allows a delegate tool call with a normal prompt", () => {
    const verdict = checkPreToolUse(
      { tool_name: "mcp__cli-dispatch__opencode_reply", tool_input: { prompt: "just a follow-up" } },
      config,
    )
    expect(verdict.block).toBe(false)
  })

  it("ignores tools that are not MCP-namespaced delegate tools", () => {
    for (const toolName of ["Bash", "codex_start", "mcp__other__codex_start"]) {
      const verdict = checkPreToolUse(
        { tool_name: toolName, tool_input: { prompt: GENERATED_MARKER } },
        config,
      )
      expect(verdict.block).toBe(false)
    }
  })

  it("allows a missing or non-string prompt argument", () => {
    expect(checkPreToolUse({ tool_name: "mcp__cli-dispatch__codex_start", tool_input: {} }, config).block).toBe(false)
    expect(checkPreToolUse({ tool_name: "mcp__cli-dispatch__codex_start" }, config).block).toBe(false)
  })
})

describe("decideUserPromptSubmit", () => {
  it("clears state and blocks on the home command with an active delegation", () => {
    setActiveDelegate("s1", "codex", "thread-1", dir)
    const decision = decideUserPromptSubmit({ session_id: "s1", prompt: "/cc" }, config, dir)
    expect(decision.kind).toBe("block")
    if (decision.kind === "block") expect(decision.reason).toContain("codex")
    expect(getActiveDelegate("s1", dir)).toBeUndefined()
  })

  it("blocks with a no-active-delegation note when /cc has nothing to clear", () => {
    const decision = decideUserPromptSubmit({ session_id: "s-empty", prompt: "/cc" }, config, dir)
    expect(decision.kind).toBe("block")
    if (decision.kind === "block") expect(decision.reason).toContain("No CLI delegation was active")
  })

  it("blocks a delegate-start command when the current model is not verified", () => {
    const decision = decideUserPromptSubmit(
      { session_id: "s2", transcript_path: transcriptWithModel("kimi-k3"), prompt: "/codex do the thing" },
      config,
      dir,
    )
    expect(decision.kind).toBe("block")
    if (decision.kind === "block") {
      expect(decision.reason).toContain("kimi-k3")
      expect(decision.reason).toContain("codex")
    }
  })

  it("passes a delegate-start command through when the model matches", () => {
    const decision = decideUserPromptSubmit(
      { session_id: "s3", transcript_path: transcriptWithModel("claude-sonnet-5"), prompt: "/codex do the thing" },
      config,
      dir,
    )
    expect(decision).toEqual({ kind: "none" })
  })

  it("fails open when the current model is unknown or no transcript exists", () => {
    const emptyTranscript = join(dir, "empty.jsonl")
    writeFileSync(emptyTranscript, JSON.stringify({ type: "user" }) + "\n")
    expect(
      decideUserPromptSubmit({ session_id: "s4", transcript_path: emptyTranscript, prompt: "/codex hi" }, config, dir),
    ).toEqual({ kind: "none" })
    expect(
      decideUserPromptSubmit({ session_id: "s4", prompt: "/codex hi" }, config, dir),
    ).toEqual({ kind: "none" })
  })

  it("fails open when verifiedModels is not configured", () => {
    const noGate: ClaudeCodeAdapterConfig = { delegates: config.delegates }
    const decision = decideUserPromptSubmit(
      { session_id: "s5", transcript_path: transcriptWithModel("anything"), prompt: "/opencode hi" },
      noGate,
      dir,
    )
    expect(decision).toEqual({ kind: "none" })
  })

  it("injects the MCP-namespaced routing rule for a follow-up with an active delegation", () => {
    setActiveDelegate("s6", "opencode", "ses_1", dir)
    const decision = decideUserPromptSubmit({ session_id: "s6", prompt: "what's 2+2?" }, config, dir)
    expect(decision.kind).toBe("inject")
    if (decision.kind === "inject") {
      expect(decision.context).toContain("DELEGATION ACTIVE")
      expect(decision.context).toContain(mcpToolName("opencode", "reply"))
    }
  })

  it("does nothing for a plain message with no active delegation", () => {
    expect(decideUserPromptSubmit({ session_id: "s7", prompt: "hello" }, config, dir)).toEqual({ kind: "none" })
  })

  it("treats a bare delegate command as a start, not a sticky follow-up", () => {
    setActiveDelegate("s8", "codex", "thread-1", dir)
    const decision = decideUserPromptSubmit(
      { session_id: "s8", transcript_path: transcriptWithModel("claude-sonnet-5"), prompt: "/opencode" },
      config,
      dir,
    )
    expect(decision).toEqual({ kind: "none" })
  })
})

describe("checkPreToolUse model gate", () => {
  const gatedConfig: ClaudeCodeAdapterConfig = {
    delegates: {
      codex: { binary: "codex", parser: "codex", startArgs: ["exec", "--", "{prompt}"], replyArgs: ["exec", "resume", "--", "{externalId}", "{prompt}"] },
    },
    verifiedModels: ["claude-good-*"],
  }

  function writeTranscript(model?: string): string {
    const path = join(dir, `transcript-${Math.random().toString(36).slice(2)}.jsonl`)
    const lines = model ? [JSON.stringify({ message: { model } })] : [JSON.stringify({ message: {} })]
    writeFileSync(path, lines.join("\n"), "utf-8")
    return path
  }

  it("blocks a direct MCP delegate tool call for a known unverified model", () => {
    const verdict = checkPreToolUse(
      { tool_name: "mcp__cli-dispatch__codex_start", tool_input: { prompt: "hi" }, transcript_path: writeTranscript("claude-bad-1") },
      gatedConfig,
    )
    expect(verdict.block).toBe(true)
    if (verdict.block) expect(verdict.reason).toContain("claude-bad-1")
  })

  it("fails open when the transcript names no model", () => {
    const verdict = checkPreToolUse(
      { tool_name: "mcp__cli-dispatch__codex_start", tool_input: { prompt: "hi" }, transcript_path: writeTranscript() },
      gatedConfig,
    )
    expect(verdict.block).toBe(false)
  })

  it("allows a verified model", () => {
    const verdict = checkPreToolUse(
      { tool_name: "mcp__cli-dispatch__codex_reply", tool_input: { prompt: "hi" }, transcript_path: writeTranscript("claude-good-5") },
      gatedConfig,
    )
    expect(verdict.block).toBe(false)
  })
})
