import { getActiveDelegate, clearActiveDelegate } from "./session-store"
import { buildRoutingRule } from "./routing-rule"

type SystemTransformInput = { sessionID?: string }
type SystemTransformOutput = { system: string[] }

export function makeSystemTransform() {
  return async (input: SystemTransformInput, output: SystemTransformOutput): Promise<void> => {
    const active = input.sessionID ? getActiveDelegate(input.sessionID) : undefined
    if (!active) return
    output.system.push(buildRoutingRule(active.delegate))
  }
}

export const MENTION_BOILERPLATE =
  /^\s*Use the above message and context to generate a prompt and call the task tool with subagent:\s*[\w-]+\s*\.?\s*$/

type PartLike = { type: string; name?: string; text?: string }

export function rewriteMentionBoilerplate(parts: PartLike[]): void {
  const mention = parts.find((p) => p.type === "agent" && typeof p.name === "string")
  if (!mention || !mention.name) return
  for (const part of parts) {
    if (part.type === "text" && typeof part.text === "string" && MENTION_BOILERPLATE.test(part.text)) {
      part.text = `The user mentioned the "${mention.name}" agent for the following request:`
    }
  }
}

type ChatMessageInput = { sessionID: string }
type ChatMessageOutput = { parts: PartLike[] }

export function makeChatMessage() {
  return async (input: ChatMessageInput, output: ChatMessageOutput): Promise<void> => {
    const active = getActiveDelegate(input.sessionID)
    if (!active) return
    rewriteMentionBoilerplate(output.parts)
  }
}

type CommandBeforeInput = { command: string; sessionID: string }
type CommandBeforeOutput = { parts: Array<{ type: string; text?: string; synthetic?: boolean }> }

export function makeCommandBefore() {
  return async (input: CommandBeforeInput, output: CommandBeforeOutput): Promise<void> => {
    if (input.command !== "opencode") return
    const active = getActiveDelegate(input.sessionID)
    clearActiveDelegate(input.sessionID)
    const note = active
      ? `[plugin] Cleared the active ${active.delegate} delegation for this session.`
      : "[plugin] No CLI delegation was active for this session."
    output.parts.push({ type: "text", text: note, synthetic: true })
  }
}
