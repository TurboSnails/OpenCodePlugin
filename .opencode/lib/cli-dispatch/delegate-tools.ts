import { tool } from "@opencode-ai/plugin"
import type { ParsedLine } from "./parse-events"
import { parseCodexLine, parseClaudeLine } from "./parse-events"
import {
  buildCodexStartArgs,
  buildCodexReplyArgs,
  buildClaudeStartArgs,
  buildClaudeReplyArgs,
} from "./delegates"
import { runDelegate } from "./run-delegate"
import { getActiveDelegate, setActiveDelegate } from "./session-store"
import type { DelegateName } from "./session-store"

export type RunDelegateFn = typeof runDelegate

export type DelegateConfig = {
  name: DelegateName
  binary: string
  parseLine: (line: string) => ParsedLine
  start: (prompt: string) => { args: string[]; externalId?: string }
  buildReplyArgs: (externalId: string, prompt: string) => string[]
}

export const DELEGATES: Record<DelegateName, DelegateConfig> = {
  codex: {
    name: "codex",
    binary: "codex",
    parseLine: parseCodexLine,
    start: (prompt) => ({ args: buildCodexStartArgs(prompt) }),
    buildReplyArgs: buildCodexReplyArgs,
  },
  claude: {
    name: "claude",
    binary: "claude",
    parseLine: parseClaudeLine,
    start: (prompt) => {
      const sessionId = crypto.randomUUID()
      return { args: buildClaudeStartArgs(sessionId, prompt), externalId: sessionId }
    },
    buildReplyArgs: buildClaudeReplyArgs,
  },
}

export function makeStartTool(cfg: DelegateConfig, run: RunDelegateFn = runDelegate) {
  return tool({
    description: `Start a new ${cfg.name} CLI session with the given task and return ${cfg.name}'s response. Use this the first time a conversation is delegated to ${cfg.name}.`,
    args: { prompt: tool.schema.string() },
    async execute(args, context) {
      const start = cfg.start(args.prompt)
      let result
      try {
        result = await run({
          binary: cfg.binary,
          args: start.args,
          parseLine: cfg.parseLine,
          onProgress: (text) => context.metadata({ title: cfg.name, metadata: { progress: text } }),
        })
      } catch (err) {
        return `${cfg.name} failed: ${err instanceof Error ? err.message : String(err)}`
      }
      const externalId = start.externalId ?? result.externalId
      if (externalId) setActiveDelegate(context.sessionID, cfg.name, externalId)
      return result.finalText || `(${cfg.name} returned no text response)`
    },
  })
}

export function makeReplyTool(cfg: DelegateConfig, run: RunDelegateFn = runDelegate) {
  return tool({
    description: `Continue the active ${cfg.name} CLI session for this conversation with a follow-up message. Requires ${cfg.name}_start to have been called first.`,
    args: { prompt: tool.schema.string() },
    async execute(args, context) {
      const active = getActiveDelegate(context.sessionID)
      if (!active || active.delegate !== cfg.name) {
        throw new Error(`No active ${cfg.name} session for this conversation. Call ${cfg.name}_start first.`)
      }
      let result
      try {
        result = await run({
          binary: cfg.binary,
          args: cfg.buildReplyArgs(active.externalId, args.prompt),
          parseLine: cfg.parseLine,
          onProgress: (text) => context.metadata({ title: cfg.name, metadata: { progress: text } }),
        })
      } catch (err) {
        return `${cfg.name} failed: ${err instanceof Error ? err.message : String(err)}`
      }
      return result.finalText || `(${cfg.name} returned no text response)`
    },
  })
}
