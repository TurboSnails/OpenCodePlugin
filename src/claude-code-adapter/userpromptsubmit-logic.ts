import { getActiveDelegate, clearActiveDelegate } from "./session-store"
import { getCurrentModel } from "./current-model"
import { matchesModelPattern, MCP_TOOL_PREFIX, type ClaudeCodeAdapterConfig } from "./config"
import { buildRoutingRule } from "../routing-rule"

export type UserPromptSubmitInput = {
  session_id: string
  prompt: string
  transcript_path: string
}

export type UserPromptSubmitAction =
  | { kind: "none" }
  | { kind: "inject"; context: string }
  | { kind: "block"; reason: string }

const HOME_COMMAND = "/cc"

function matchesCommand(prompt: string, command: string): boolean {
  return prompt === command || prompt.startsWith(`${command} `)
}

export function decideUserPromptSubmit(
  input: UserPromptSubmitInput,
  config: ClaudeCodeAdapterConfig,
): UserPromptSubmitAction {
  const prompt = input.prompt.trim()

  if (matchesCommand(prompt, HOME_COMMAND)) {
    const active = getActiveDelegate(input.session_id)
    clearActiveDelegate(input.session_id)
    const reason = active
      ? `[plugin] Cleared the active ${active.delegate} delegation for this session.`
      : "[plugin] No CLI delegation was active for this session."
    return { kind: "block", reason }
  }

  for (const name of Object.keys(config.delegates)) {
    if (!matchesCommand(prompt, `/${name}`)) continue

    const patterns = config.verifiedModels
    if (patterns && patterns.length > 0) {
      const model = getCurrentModel(input.transcript_path)
      if (model && !matchesModelPattern(model, patterns)) {
        return {
          kind: "block",
          reason: `[plugin] The current model (${model}) is not on the verified-models allow-list for CLI delegation, so ${name} was not started. Switch to a verified model and try again.`,
        }
      }
    }

    return { kind: "none" }
  }

  const active = getActiveDelegate(input.session_id)
  if (active) {
    return { kind: "inject", context: buildRoutingRule(active.delegate, `${MCP_TOOL_PREFIX}${active.delegate}_reply`) }
  }

  return { kind: "none" }
}
