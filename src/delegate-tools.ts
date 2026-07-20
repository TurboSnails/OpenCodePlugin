import { tool } from "@opencode-ai/plugin"
import type { DelegateConfig } from "./config"
import { resolveArgs } from "./config"
import { runDelegate } from "./run-delegate"
import { getActiveDelegate, setActiveDelegate } from "./session-store"
import type { ParserName } from "./config"

export type RunDelegateFn = typeof runDelegate

const SUMMARY_LINE_CAP = 50

export function snapshotWorktree(cwd: string): string | null {
  try {
    const result = Bun.spawnSync(["git", "status", "--porcelain"], { cwd })
    if (!result.success) return null
    return result.stdout.toString()
  } catch {
    return null
  }
}

export function buildChangeSummary(before: string, after: string, cwd: string): string | null {
  if (before === after) return null

  let stat = ""
  try {
    const result = Bun.spawnSync(["git", "diff", "--stat"], { cwd })
    if (result.success) stat = result.stdout.toString().trimEnd()
  } catch {}

  const beforeUntracked = new Set(
    before.split("\n").filter((l) => l.startsWith("?? ")).map((l) => l.slice(3)),
  )
  const newFiles = after
    .split("\n")
    .filter((l) => l.startsWith("?? "))
    .map((l) => l.slice(3))
    .filter((f) => !beforeUntracked.has(f))

  const lines: string[] = []
  if (stat) lines.push(...stat.split("\n"))
  for (const f of newFiles) lines.push(`new file: ${f}`)

  if (lines.length === 0) return null

  let truncated = false
  if (lines.length > SUMMARY_LINE_CAP) {
    lines.length = SUMMARY_LINE_CAP
    truncated = true
  }
  const body = lines.join("\n") + (truncated ? "\n... (truncated)" : "")
  return `\n\n---\nChanged during this run:\n${body}`
}

export function makeStartTool(
  name: string,
  cfg: DelegateConfig,
  run: RunDelegateFn = runDelegate,
) {
  return tool({
    description: `Start a new ${name} CLI session with the given task and return ${name}'s response. Use this the first time a conversation is delegated to ${name}.`,
    args: { prompt: tool.schema.string() },
    async execute(args, context) {
      const sessionId = crypto.randomUUID()
      const resolvedArgs = resolveArgs(cfg.startArgs, {
        prompt: args.prompt,
        sessionId,
      })

      const before = snapshotWorktree(process.cwd())

      let result
      try {
        result = await run({
          binary: cfg.binary,
          args: resolvedArgs,
          parser: cfg.parser,
          onProgress: (text) => context.metadata({ title: name, metadata: { progress: text } }),
        })
      } catch (err) {
        return `${name} failed: ${err instanceof Error ? err.message : String(err)}. Use /opencode to exit delegation.`
      }

      const externalId = result.externalId ?? sessionId
      if (externalId) {
        setActiveDelegate(context.sessionID, name, externalId)
      }

      const summary = before === null ? null : buildChangeSummary(before, snapshotWorktree(process.cwd()) ?? before, process.cwd())
      return (result.finalText || `(${name} returned no text response)`) + (summary ?? "")
    },
  })
}

export function makeReplyTool(
  name: string,
  cfg: DelegateConfig,
  run: RunDelegateFn = runDelegate,
) {
  return tool({
    description: `Continue the active ${name} CLI session for this conversation with a follow-up message. Requires ${name}_start to have been called first.`,
    args: { prompt: tool.schema.string() },
    async execute(args, context) {
      const active = getActiveDelegate(context.sessionID)
      if (!active || active.delegate !== name) {
        throw new Error(`No active ${name} session for this conversation. Call ${name}_start first.`)
      }

      const resolvedArgs = resolveArgs(cfg.replyArgs, {
        prompt: args.prompt,
        externalId: active.externalId,
      })

      const before = snapshotWorktree(process.cwd())

      let result
      try {
        result = await run({
          binary: cfg.binary,
          args: resolvedArgs,
          parser: cfg.parser,
          onProgress: (text) => context.metadata({ title: name, metadata: { progress: text } }),
        })
      } catch (err) {
        return `${name} failed: ${err instanceof Error ? err.message : String(err)}. Use /opencode to exit delegation.`
      }

      const summary = before === null ? null : buildChangeSummary(before, snapshotWorktree(process.cwd()) ?? before, process.cwd())
      return (result.finalText || `(${name} returned no text response)`) + (summary ?? "")
    },
  })
}
