import { GENERATED_MARKER, checkDelegationGate } from "../../policy"
import { loadCodexAdapterConfig, type CodexAdapterConfig } from "../config"
import { MCP_SERVER_NAME } from "../constants"

export type PreToolUseInput = {
  tool_name?: string
  tool_input?: Record<string, unknown>
  model?: string
}

export type PreToolUseOutput = {
  hookSpecificOutput?: {
    hookEventName: "PreToolUse"
    permissionDecision: "deny"
    permissionDecisionReason: string
  }
}

function mcpToolName(delegate: string, kind: "start" | "reply"): string {
  return `mcp__${MCP_SERVER_NAME}__${delegate}_${kind}`
}

export function handlePreToolUse(input: PreToolUseInput, config?: CodexAdapterConfig): PreToolUseOutput | undefined {
  const cfg = config ?? loadCodexAdapterConfig()
  const delegateTools = new Set(Object.keys(cfg.delegates).flatMap((name) => [mcpToolName(name, "start"), mcpToolName(name, "reply")]))
  if (!input.tool_name || !delegateTools.has(input.tool_name)) return undefined

  const prompt = input.tool_input?.prompt
  const model = input.model
  const patterns = cfg.verifiedModels
  const delegate = input.tool_name!.replace(/^mcp__cli_dispatch__/, "").replace(/_(start|reply)$/, "")
  const decision = checkDelegationGate({
    target: { kind: "tool", delegate, tool: input.tool_name! },
    prompt,
    model,
    verifiedModels: patterns,
    prefix: "[cli-dispatch]",
  })
  if (decision.allow) return undefined
  return {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: decision.reason,
    },
  }
}
