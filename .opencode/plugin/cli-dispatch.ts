// .opencode/plugin/cli-dispatch.ts
import type { Plugin } from "@opencode-ai/plugin"
import { tool } from "@opencode-ai/plugin"
import { getActiveDelegate, setActiveDelegate } from "../lib/cli-dispatch/session-store"
import {
  parseCodexLine,
  parseClaudeLine,
  parseKimiLine,
  parseKimiStderrForSessionId,
} from "../lib/cli-dispatch/parse-events"
import {
  buildCodexStartArgs,
  buildCodexReplyArgs,
  buildClaudeStartArgs,
  buildClaudeReplyArgs,
  buildKimiStartArgs,
  buildKimiReplyArgs,
} from "../lib/cli-dispatch/delegates"
import { runDelegate } from "../lib/cli-dispatch/run-delegate"

const CliDispatchPlugin: Plugin = async () => {
  return {
    tool: {
      codex_start: tool({
        description:
          "Start a new codex CLI session with the given task and return codex's response. Use this the first time a conversation is delegated to codex.",
        args: { prompt: tool.schema.string() },
        async execute(args, context) {
          let result
          try {
            result = await runDelegate({
              binary: "codex",
              args: buildCodexStartArgs(args.prompt),
              parseLine: parseCodexLine,
              onProgress: (text) => context.metadata({ title: "codex", metadata: { progress: text } }),
            })
          } catch (err) {
            return `codex failed: ${err instanceof Error ? err.message : String(err)}`
          }
          if (result.externalId) setActiveDelegate(context.sessionID, "codex", result.externalId)
          return result.finalText || "(codex returned no text response)"
        },
      }),
      codex_reply: tool({
        description:
          "Continue the active codex CLI session for this conversation with a follow-up message. Requires codex_start to have been called first.",
        args: { prompt: tool.schema.string() },
        async execute(args, context) {
          const active = getActiveDelegate(context.sessionID)
          if (!active || active.delegate !== "codex") {
            throw new Error("No active codex session for this conversation. Call codex_start first.")
          }
          let result
          try {
            result = await runDelegate({
              binary: "codex",
              args: buildCodexReplyArgs(active.externalId, args.prompt),
              parseLine: parseCodexLine,
              onProgress: (text) => context.metadata({ title: "codex", metadata: { progress: text } }),
            })
          } catch (err) {
            return `codex failed: ${err instanceof Error ? err.message : String(err)}`
          }
          return result.finalText || "(codex returned no text response)"
        },
      }),
      claude_start: tool({
        description:
          "Start a new claude (Claude Code) CLI session with the given task and return its response. Use this the first time a conversation is delegated to claude.",
        args: { prompt: tool.schema.string() },
        async execute(args, context) {
          const sessionId = crypto.randomUUID()
          let result
          try {
            result = await runDelegate({
              binary: "claude",
              args: buildClaudeStartArgs(sessionId, args.prompt),
              parseLine: parseClaudeLine,
              onProgress: (text) => context.metadata({ title: "claude", metadata: { progress: text } }),
            })
          } catch (err) {
            return `claude failed: ${err instanceof Error ? err.message : String(err)}`
          }
          setActiveDelegate(context.sessionID, "claude", sessionId)
          return result.finalText || "(claude returned no text response)"
        },
      }),
      claude_reply: tool({
        description:
          "Continue the active claude CLI session for this conversation with a follow-up message. Requires claude_start to have been called first.",
        args: { prompt: tool.schema.string() },
        async execute(args, context) {
          const active = getActiveDelegate(context.sessionID)
          if (!active || active.delegate !== "claude") {
            throw new Error("No active claude session for this conversation. Call claude_start first.")
          }
          let result
          try {
            result = await runDelegate({
              binary: "claude",
              args: buildClaudeReplyArgs(active.externalId, args.prompt),
              parseLine: parseClaudeLine,
              onProgress: (text) => context.metadata({ title: "claude", metadata: { progress: text } }),
            })
          } catch (err) {
            return `claude failed: ${err instanceof Error ? err.message : String(err)}`
          }
          return result.finalText || "(claude returned no text response)"
        },
      }),
      kimi_start: tool({
        description:
          "Start a new kimi CLI session with the given task and return its response. Use this the first time a conversation is delegated to kimi.",
        args: { prompt: tool.schema.string() },
        async execute(args, context) {
          let result
          try {
            result = await runDelegate({
              binary: "kimi",
              args: buildKimiStartArgs(args.prompt),
              parseLine: parseKimiLine,
              onProgress: (text) => context.metadata({ title: "kimi", metadata: { progress: text } }),
            })
          } catch (err) {
            return `kimi failed: ${err instanceof Error ? err.message : String(err)}`
          }
          const sessionId = parseKimiStderrForSessionId(result.stderrText)
          if (sessionId) setActiveDelegate(context.sessionID, "kimi", sessionId)
          return result.finalText || "(kimi returned no text response)"
        },
      }),
      kimi_reply: tool({
        description:
          "Continue the active kimi CLI session for this conversation with a follow-up message. Requires kimi_start to have been called first.",
        args: { prompt: tool.schema.string() },
        async execute(args, context) {
          const active = getActiveDelegate(context.sessionID)
          if (!active || active.delegate !== "kimi") {
            throw new Error("No active kimi session for this conversation. Call kimi_start first.")
          }
          let result
          try {
            result = await runDelegate({
              binary: "kimi",
              args: buildKimiReplyArgs(active.externalId, args.prompt),
              parseLine: parseKimiLine,
              onProgress: (text) => context.metadata({ title: "kimi", metadata: { progress: text } }),
            })
          } catch (err) {
            return `kimi failed: ${err instanceof Error ? err.message : String(err)}`
          }
          return result.finalText || "(kimi returned no text response)"
        },
      }),
    },
  }
}

export default CliDispatchPlugin
