import { getActiveDelegate } from "./session-store"
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
