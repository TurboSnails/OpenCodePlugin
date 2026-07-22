import type { DelegateConfig } from "../config"
import { resolveArgs } from "../config"
import { runDelegate } from "../run-delegate"
import { snapshotWorktree, buildChangeSummary } from "../worktree-summary"
import { getActiveDelegate, setActiveDelegate, beginDelegateStart, isLatestDelegateStart } from "./session-store"

export type RunDelegateFn = typeof runDelegate

// Default per-run timeout for a delegate CLI invocation; a delegate config
// may override it with its own timeoutMs.
const DEFAULT_DELEGATE_TIMEOUT_MS = 10 * 60 * 1000

export type DelegateRunOptions = {
  run?: RunDelegateFn
  cwd?: string
  stateDir?: string
  onProgress?: (text: string) => void
}

// Mirrors src/delegate-tools.ts's makeStartTool/makeReplyTool for Claude
// Code's MCP tool handlers, minus the OpenCode-specific restrictive-agent
// check (no Claude Code equivalent) and with file-backed session state keyed
// by the Claude Code session id (design.md D5/D8).
export async function startDelegate(
  name: string,
  cfg: DelegateConfig,
  claudeSessionId: string,
  prompt: string,
  options: DelegateRunOptions = {},
): Promise<string> {
  const run = options.run ?? runDelegate
  const delegateSessionId = crypto.randomUUID()
  const startSequence = beginDelegateStart(claudeSessionId, options.stateDir)
  const resolvedArgs = resolveArgs(cfg.startArgs, {
    prompt,
    sessionId: delegateSessionId,
  })

  const workDir = options.cwd ?? process.cwd()
  const before = snapshotWorktree(workDir)

  let result
  try {
    result = await run({
      binary: cfg.binary,
      args: resolvedArgs,
      parser: cfg.parser,
      onProgress: options.onProgress ?? (() => {}),
      timeoutMs: cfg.timeoutMs ?? DEFAULT_DELEGATE_TIMEOUT_MS,
      cwd: workDir,
    })
  } catch (err) {
    return `${name} failed: ${err instanceof Error ? err.message : String(err)}. Use /cc to exit delegation.`
  }

  const externalId = result.externalId ?? delegateSessionId
  if (externalId && isLatestDelegateStart(claudeSessionId, startSequence, options.stateDir)) {
    setActiveDelegate(claudeSessionId, name, externalId, options.stateDir)
  }

  const summary = before === null ? null : buildChangeSummary(before, snapshotWorktree(workDir) ?? before, workDir)
  return (result.finalText || `(${name} returned no text response)`) + (summary ?? "")
}

export async function replyDelegate(
  name: string,
  cfg: DelegateConfig,
  claudeSessionId: string,
  prompt: string,
  options: DelegateRunOptions = {},
): Promise<string> {
  const active = getActiveDelegate(claudeSessionId, options.stateDir)
  if (!active || active.delegate !== name) {
    throw new Error(`No active ${name} session for this conversation. Call ${name}_start first.`)
  }

  const run = options.run ?? runDelegate
  const resolvedArgs = resolveArgs(cfg.replyArgs, {
    prompt,
    externalId: active.externalId,
  })

  const workDir = options.cwd ?? process.cwd()
  const before = snapshotWorktree(workDir)

  let result
  try {
    result = await run({
      binary: cfg.binary,
      args: resolvedArgs,
      parser: cfg.parser,
      onProgress: options.onProgress ?? (() => {}),
      timeoutMs: cfg.timeoutMs ?? DEFAULT_DELEGATE_TIMEOUT_MS,
      cwd: workDir,
    })
  } catch (err) {
    return `${name} failed: ${err instanceof Error ? err.message : String(err)}. Use /cc to exit delegation.`
  }

  const summary = before === null ? null : buildChangeSummary(before, snapshotWorktree(workDir) ?? before, workDir)
  return (result.finalText || `(${name} returned no text response)`) + (summary ?? "")
}
