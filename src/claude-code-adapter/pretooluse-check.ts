import { GENERATED_MARKER, checkDelegationGate } from "../policy"
import { getCurrentModel } from "./current-model"
import { type ClaudeCodeAdapterConfig } from "./config"

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
  const patterns = config.verifiedModels
  const model = input.transcript_path ? getCurrentModel(input.transcript_path) : undefined
  const delegate = input.tool_name.replace(/^mcp__cli-dispatch__/, "").replace(/_(start|reply)$/, "")
  const decision = checkDelegationGate({
    target: { kind: "tool", delegate, tool: input.tool_name },
    prompt,
    model,
    verifiedModels: patterns,
    prefix: "[cli-dispatch]",
  })
  return decision.allow ? { block: false } : { block: true, reason: decision.reason }
}
