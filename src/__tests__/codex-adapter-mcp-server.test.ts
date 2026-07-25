import { describe, it, expect } from "bun:test"
import { MCP_SERVER_NAME, mcpToolName, listCodexDelegateTools } from "../codex-adapter/mcp-server"
import type { CodexAdapterConfig } from "../codex-adapter/config"

const config: CodexAdapterConfig = {
  delegates: {
    claude: {
      binary: "claude",
      parser: "claude",
      startArgs: ["-p", "--", "{prompt}"],
      replyArgs: ["-p", "--", "{prompt}"],
    },
  },
}

describe("mcpToolName", () => {
  it("formats Codex hook tool names", () => {
    expect(MCP_SERVER_NAME).toBe("cli_dispatch")
    expect(mcpToolName("claude", "start")).toBe("mcp__cli_dispatch__claude_start")
    expect(mcpToolName("claude", "reply")).toBe("mcp__cli_dispatch__claude_reply")
  })
})

describe("listCodexDelegateTools", () => {
  it("lists start, reply, and status tools for each delegate", () => {
    expect(listCodexDelegateTools(config)).toEqual(["claude_start", "claude_reply", "cli_dispatch_status"])
  })
})
