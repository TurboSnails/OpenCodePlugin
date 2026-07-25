import { GENERATED_MARKER } from "../../policy"
import { writeCurrentSession, codexFileDelegateStore } from "../session-store"

export type UserPromptSubmitInput = {
  session_id?: string
  prompt?: string
}

export type UserPromptSubmitOutput = {
  continue?: boolean
  systemMessage?: string
  hookSpecificOutput?: {
    hookEventName: "UserPromptSubmit"
    additionalContext?: string
  }
  decision?: "block"
  reason?: string
}

const EXIT_RE = /^\s*\/(?:prompts:)?opencode\b/

export function handleUserPromptSubmit(input: UserPromptSubmitInput, stateDir?: string): UserPromptSubmitOutput {
  const sessionId = input.session_id
  if (!sessionId) return {}

  writeCurrentSession(sessionId, stateDir)

  const store = codexFileDelegateStore(stateDir)
  const active = store.getActiveDelegate(sessionId)
  const prompt = input.prompt ?? ""

  if (EXIT_RE.test(prompt)) {
    if (active) {
      store.clearActiveDelegate(sessionId)
      return { systemMessage: `[cli-dispatch] Cleared the active ${active.delegate} delegation for this session.` }
    }
    return { systemMessage: "[cli-dispatch] No CLI delegation was active for this session." }
  }

  if (prompt.includes(GENERATED_MARKER)) {
    return {
      decision: "block",
      reason: "The prompt contains the whole delegate command template instead of the user's actual message. Pass only the user's text.",
    }
  }

  if (!active) return {}

  return {
    hookSpecificOutput: {
      hookEventName: "UserPromptSubmit",
      additionalContext: `There is an active ${active.delegate} delegation for this session. Call the MCP tool ${active.delegate}_reply with the user's prompt as the "prompt" argument; do not answer directly.`,
    },
  }
}
