import { GENERATED_MARKER } from "../policy"
import { getCurrentModel } from "./current-model"
import { matchesModelPattern, type ClaudeCodeAdapterConfig } from "./config"

// The MCP server name from .mcp.json; Claude Code names MCP tools
// `mcp__<server>__<tool>` in hook payloads (design.md D3).
export const MCP_SERVER_NAME = "cli-dispatch"

export function mcpToolName(delegate: string, kind: "start" | "reply"): string {
  return `mcp__${MCP_SERVER_NAME}__${delegate}_${kind}`
}

export type PreToolUseInput = {
  tool_name?: string
  tool_input?: Record<string, unknown>
  transcript_path?: string
}

export type PreToolUseVerdict = { block: false } | { block: true; reason: string }

// Same prompt-template-sanitization check as OpenCode's makeToolExecuteBefore
// (hooks.ts), expressed as an exit-code verdict for Claude Code's hook model.
export function checkPreToolUse(input: PreToolUseInput, config: ClaudeCodeAdapterConfig): PreToolUseVerdict {
  const delegateTools = new Set(
    Object.keys(config.delegates).flatMap((name) => [mcpToolName(name, "start"), mcpToolName(name, "reply")]),
  )
  if (!input.tool_name || !delegateTools.has(input.tool_name)) return { block: false }

  const prompt = input.tool_input?.prompt
  if (typeof prompt === "string" && prompt.includes(GENERATED_MARKER)) {
    return {
      block: true,
      reason: `${input.tool_name} rejected: the "prompt" argument contains the whole delegate command template instead of the user's actual message. Pass only the user's text as "prompt".`,
    }
  }

  // Model gate on the direct tool path (design D3): the transcript-derived
  // current model is checked against verifiedModels. Unknown model fails
  // open — a guardrail against known-bad models, not a sandbox.
  const patterns = config.verifiedModels
  if (!patterns || patterns.length === 0) return { block: false }
  const model = input.transcript_path ? getCurrentModel(input.transcript_path) : undefined
  if (!model) return { block: false }
  if (matchesModelPattern(model, patterns)) return { block: false }
  return {
    block: true,
    reason: `[cli-dispatch] The current model (${model}) is not on the verified-models allow-list for CLI delegation, so ${input.tool_name} was blocked. Switch to a verified model and try again.`,
  }
}
