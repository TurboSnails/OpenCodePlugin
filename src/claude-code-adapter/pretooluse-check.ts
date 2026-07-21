import { GENERATED_MARKER } from "../commands"
import { MCP_TOOL_PREFIX } from "./config"

export type PreToolUseInput = {
  tool_name: string
  tool_input: Record<string, unknown>
}

export type PreToolUseVerdict = { block: false } | { block: true; reason: string }

export function checkPreToolUse(input: PreToolUseInput, delegateNames: string[]): PreToolUseVerdict {
  const delegateToolNames = new Set(
    delegateNames.flatMap((name) => [`${MCP_TOOL_PREFIX}${name}_start`, `${MCP_TOOL_PREFIX}${name}_reply`]),
  )

  if (!delegateToolNames.has(input.tool_name)) return { block: false }

  const prompt = input.tool_input.prompt
  if (typeof prompt === "string" && prompt.includes(GENERATED_MARKER)) {
    return {
      block: true,
      reason: `${input.tool_name} rejected: the "prompt" argument contains the whole delegate command template instead of the user's actual message. Pass only the user's text as "prompt".`,
    }
  }

  return { block: false }
}
