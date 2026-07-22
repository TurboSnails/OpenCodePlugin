import { getActiveDelegate, clearActiveDelegate, setSessionAgent, setSessionModel, getSessionModel } from "./session-store"
import { buildRoutingRule } from "./routing-rule"
import { matchesVerifiedModel, type CliDispatchConfig } from "./config"
import { GENERATED_MARKER } from "./policy"

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

type ChatMessageInput = { sessionID: string; agent?: string; model?: { providerID: string; modelID: string } }
type ChatMessageOutput = { parts: PartLike[] }

export function makeChatMessage() {
  return async (input: ChatMessageInput, output: ChatMessageOutput): Promise<void> => {
    if (input.agent) setSessionAgent(input.sessionID, input.agent)
    if (input.model) setSessionModel(input.sessionID, input.model)

    const active = getActiveDelegate(input.sessionID)
    if (!active) return
    rewriteMentionBoilerplate(output.parts)
  }
}

type CommandBeforeInput = { command: string; sessionID: string }
type CommandBeforeOutput = { parts: Array<{ type: string; text?: string; synthetic?: boolean }> }

// The queued command text (generated or hand-maintained) always instructs the
// model to call `{name}_start` verbatim, regardless of what the slash command
// itself is named (e.g. this repo's `/cc` targets the `claude` delegate but
// isn't named `claude`) — so the delegate is detected from that text, not
// from `input.command`.
function detectTargetedDelegate(parts: CommandBeforeOutput["parts"], delegateNames: string[]): string | undefined {
  const text = parts.map((p) => p.text ?? "").join("\n")
  return delegateNames.find((name) => text.includes(`${name}_start`))
}

export function makeCommandBefore(config: CliDispatchConfig) {
  return async (input: CommandBeforeInput, output: CommandBeforeOutput): Promise<void> => {
    if (input.command === "opencode") {
      const active = getActiveDelegate(input.sessionID)
      clearActiveDelegate(input.sessionID)
      const note = active
        ? `[plugin] Cleared the active ${active.delegate} delegation for this session.`
        : "[plugin] No CLI delegation was active for this session."
      output.parts.push({ type: "text", text: note, synthetic: true })
      return
    }

    const patterns = config.verifiedModels
    if (!patterns || patterns.length === 0) return

    const delegate = detectTargetedDelegate(output.parts, Object.keys(config.delegates))
    if (!delegate) return

    const model = getSessionModel(input.sessionID)
    if (!model) return // unknown model: fail open (see design.md D2)

    if (matchesVerifiedModel(model, patterns)) return

    output.parts.length = 0
    output.parts.push({
      type: "text",
      text: `[plugin] The current model (${model.providerID}/${model.modelID}) is not on the verified-models allow-list for CLI delegation, so ${delegate} was not started. Switch to a verified model and try again.`,
      synthetic: true,
    })
  }
}

type ToolExecuteBeforeInput = { tool: string; sessionID: string; callID: string }
type ToolExecuteBeforeOutput = { args: any }

export function makeToolExecuteBefore(config: CliDispatchConfig) {
  const delegateToolNames = new Set(
    Object.keys(config.delegates).flatMap((name) => [`${name}_start`, `${name}_reply`]),
  )

  return async (input: ToolExecuteBeforeInput, output: ToolExecuteBeforeOutput): Promise<void> => {
    if (!delegateToolNames.has(input.tool)) return

    const prompt = output.args?.prompt
    if (typeof prompt === "string" && prompt.includes(GENERATED_MARKER)) {
      throw new Error(
        `${input.tool} rejected: the "prompt" argument contains the whole delegate command template instead of the user's actual message. Pass only the user's text as "prompt".`,
      )
    }
  }
}
