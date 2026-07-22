import { describe, it, expect } from "bun:test"
import { makeChatMessage, makeCommandBefore, makeToolExecuteBefore } from "../hooks"
import { getSessionAgent, getSessionModel, setSessionModel, setActiveDelegate, getActiveDelegate } from "../session-store"
import type { CliDispatchConfig } from "../config"
import { GENERATED_MARKER } from "../commands"

describe("makeChatMessage", () => {
  it("caches the session's agent from chat.message input", async () => {
    const hook = makeChatMessage()
    await hook({ sessionID: "chat-msg-session-1", agent: "plan" }, { parts: [] })

    expect(getSessionAgent("chat-msg-session-1")).toBe("plan")
  })

  it("leaves any previously cached agent untouched when input has none", async () => {
    const hook = makeChatMessage()
    await hook({ sessionID: "chat-msg-session-2", agent: "build" }, { parts: [] })
    await hook({ sessionID: "chat-msg-session-2" }, { parts: [] })

    expect(getSessionAgent("chat-msg-session-2")).toBe("build")
  })

  it("caches the session's model from chat.message input", async () => {
    const hook = makeChatMessage()
    await hook({ sessionID: "chat-msg-session-3", model: { providerID: "anthropic", modelID: "claude-sonnet-4-5" } }, { parts: [] })

    expect(getSessionModel("chat-msg-session-3")).toEqual({ providerID: "anthropic", modelID: "claude-sonnet-4-5" })
  })

  it("leaves any previously cached model untouched when input has none", async () => {
    const hook = makeChatMessage()
    await hook({ sessionID: "chat-msg-session-4", model: { providerID: "minimax-cn", modelID: "MiniMax-M2.5" } }, { parts: [] })
    await hook({ sessionID: "chat-msg-session-4" }, { parts: [] })

    expect(getSessionModel("chat-msg-session-4")).toEqual({ providerID: "minimax-cn", modelID: "MiniMax-M2.5" })
  })
})

const baseConfig: CliDispatchConfig = {
  delegates: {
    claude: { binary: "claude", parser: "claude", startArgs: ["{prompt}"], replyArgs: ["{externalId}", "{prompt}"] },
  },
}

const claudeStartParts = () => [
  { type: "text", text: "call the `claude_start` tool with the user's message" },
]

describe("makeCommandBefore: /opencode exit", () => {
  it("clears an active delegation and reports which delegate was cleared", async () => {
    setActiveDelegate("cmd-before-opencode-1", "claude", "ext-1")
    const hook = makeCommandBefore(baseConfig)
    const output = { parts: [] as Array<{ type: string; text?: string; synthetic?: boolean }> }

    await hook({ command: "opencode", sessionID: "cmd-before-opencode-1" }, output)

    expect(getActiveDelegate("cmd-before-opencode-1")).toBeUndefined()
    expect(output.parts).toHaveLength(1)
    expect(output.parts[0].text).toContain("Cleared the active claude delegation")
  })

  it("reports no active delegation as a no-op", async () => {
    const hook = makeCommandBefore(baseConfig)
    const output = { parts: [] as Array<{ type: string; text?: string; synthetic?: boolean }> }

    await hook({ command: "opencode", sessionID: "cmd-before-opencode-2" }, output)

    expect(output.parts[0].text).toContain("No CLI delegation was active")
  })
})

describe("makeCommandBefore: verified-models gate", () => {
  it("allows a delegate-start command through when no verifiedModels is configured", async () => {
    const hook = makeCommandBefore(baseConfig)
    setSessionModel("cmd-before-gate-1", { providerID: "minimax-cn", modelID: "MiniMax-M2.5" })
    const output = { parts: claudeStartParts() }

    await hook({ command: "cc", sessionID: "cmd-before-gate-1" }, output)

    expect(output.parts).toEqual(claudeStartParts())
  })

  it("allows a delegate-start command through when the model matches the allow-list", async () => {
    const config: CliDispatchConfig = { ...baseConfig, verifiedModels: ["anthropic/*"] }
    const hook = makeCommandBefore(config)
    setSessionModel("cmd-before-gate-2", { providerID: "anthropic", modelID: "claude-sonnet-4-5" })
    const output = { parts: claudeStartParts() }

    await hook({ command: "cc", sessionID: "cmd-before-gate-2" }, output)

    expect(output.parts).toEqual(claudeStartParts())
  })

  it("blocks a delegate-start command when the tracked model matches no allow-list entry", async () => {
    const config: CliDispatchConfig = { ...baseConfig, verifiedModels: ["anthropic/*"] }
    const hook = makeCommandBefore(config)
    setSessionModel("cmd-before-gate-3", { providerID: "minimax-cn", modelID: "MiniMax-M2.5" })
    const output = { parts: claudeStartParts() }

    await hook({ command: "cc", sessionID: "cmd-before-gate-3" }, output)

    expect(output.parts).toHaveLength(1)
    expect(output.parts[0].text).toContain("minimax-cn/MiniMax-M2.5")
    expect(output.parts[0].text).toContain("not on the verified-models allow-list")
    expect(output.parts[0].text).not.toContain("claude_start")
  })

  it("fails open when no model has been tracked yet for the session", async () => {
    const config: CliDispatchConfig = { ...baseConfig, verifiedModels: ["anthropic/*"] }
    const hook = makeCommandBefore(config)
    const output = { parts: claudeStartParts() }

    await hook({ command: "cc", sessionID: "cmd-before-gate-untracked" }, output)

    expect(output.parts).toEqual(claudeStartParts())
  })

  it("leaves parts untouched when the command doesn't target any configured delegate", async () => {
    const config: CliDispatchConfig = { ...baseConfig, verifiedModels: ["anthropic/*"] }
    const hook = makeCommandBefore(config)
    setSessionModel("cmd-before-gate-4", { providerID: "minimax-cn", modelID: "MiniMax-M2.5" })
    const output = { parts: [{ type: "text", text: "some unrelated command content" }] }

    await hook({ command: "opsx-explore", sessionID: "cmd-before-gate-4" }, output)

    expect(output.parts).toEqual([{ type: "text", text: "some unrelated command content" }])
  })
})

describe("makeToolExecuteBefore", () => {
  it("rejects a claude_start prompt containing the generated-command marker", async () => {
    const hook = makeToolExecuteBefore(baseConfig)
    const output = { args: { prompt: `${GENERATED_MARKER}\nDelegate this conversation to the claude CLI.` } }

    await expect(hook({ tool: "claude_start", sessionID: "tool-before-1", callID: "call-1" }, output)).rejects.toThrow(/prompt/)
  })

  it("rejects a claude_reply prompt containing the generated-command marker", async () => {
    const hook = makeToolExecuteBefore(baseConfig)
    const output = { args: { prompt: `some text\n${GENERATED_MARKER}\nmore text` } }

    await expect(hook({ tool: "claude_reply", sessionID: "tool-before-2", callID: "call-2" }, output)).rejects.toThrow()
  })

  it("allows an ordinary user prompt through unchanged", async () => {
    const hook = makeToolExecuteBefore(baseConfig)
    const output = { args: { prompt: "please fix the failing test in src/index.ts" } }

    await hook({ tool: "claude_start", sessionID: "tool-before-3", callID: "call-3" }, output)

    expect(output.args.prompt).toBe("please fix the failing test in src/index.ts")
  })

  it("ignores tools that are not configured delegate start/reply tools", async () => {
    const hook = makeToolExecuteBefore(baseConfig)
    const output = { args: { prompt: GENERATED_MARKER } }

    await hook({ tool: "some_other_tool", sessionID: "tool-before-4", callID: "call-4" }, output)

    expect(output.args.prompt).toBe(GENERATED_MARKER)
  })
})

describe("makeToolExecuteBefore model gate", () => {
  const config: CliDispatchConfig = {
    delegates: {
      claude: { binary: "claude", parser: "claude", startArgs: ["--", "{prompt}"], replyArgs: ["--resume", "{externalId}", "--", "{prompt}"] },
    },
    verifiedModels: ["good/model"],
  }

  it("blocks a direct delegate tool call for a known unverified model", async () => {
    setSessionModel("gate-s1", { providerID: "bad", modelID: "model" })
    const handler = makeToolExecuteBefore(config)
    await expect(
      handler({ tool: "claude_start", sessionID: "gate-s1", callID: "c1" }, { args: { prompt: "hi" } }),
    ).rejects.toThrow("not on the verified-models allow-list")
  })

  it("blocks delegate replies as well as starts", async () => {
    setSessionModel("gate-s2", { providerID: "bad", modelID: "model" })
    const handler = makeToolExecuteBefore(config)
    await expect(
      handler({ tool: "claude_reply", sessionID: "gate-s2", callID: "c2" }, { args: { prompt: "hi" } }),
    ).rejects.toThrow("claude_reply was blocked")
  })

  it("fails open when the model is unknown", async () => {
    const handler = makeToolExecuteBefore(config)
    await expect(
      handler({ tool: "claude_start", sessionID: "gate-unknown", callID: "c3" }, { args: { prompt: "hi" } }),
    ).resolves.toBeUndefined()
  })

  it("allows a verified model and ignores non-delegate tools", async () => {
    setSessionModel("gate-s3", { providerID: "good", modelID: "model" })
    const handler = makeToolExecuteBefore(config)
    await expect(
      handler({ tool: "claude_start", sessionID: "gate-s3", callID: "c4" }, { args: { prompt: "hi" } }),
    ).resolves.toBeUndefined()
    setSessionModel("gate-s4", { providerID: "bad", modelID: "model" })
    await expect(
      handler({ tool: "bash", sessionID: "gate-s4", callID: "c5" }, { args: {} }),
    ).resolves.toBeUndefined()
  })

  it("applies no gate when verifiedModels is empty", async () => {
    setSessionModel("gate-s5", { providerID: "bad", modelID: "model" })
    const handler = makeToolExecuteBefore({ delegates: config.delegates })
    await expect(
      handler({ tool: "claude_start", sessionID: "gate-s5", callID: "c6" }, { args: { prompt: "hi" } }),
    ).resolves.toBeUndefined()
  })
})
