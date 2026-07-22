// Host-agnostic delegate-turn orchestration (design D6): sequencing, argv
// resolution, process lifecycle, session-id capture and validation, change
// summary, and error wording — implemented once for both hosts. Host
// adapters translate their native tool shapes into these two calls and
// supply their own store, home-command name, and (where supported) abort
// signal.
import type { DelegateConfig } from "./config"
import { resolveArgs } from "./config"
import { runDelegate } from "./run-delegate"
import type { DelegateStore } from "./delegate-store"
import { snapshotWorktree, buildChangeSummary } from "./worktree-summary"
import { isValidExternalId } from "./policy"

export type RunDelegateFn = typeof runDelegate

// Default per-run timeout for a delegate CLI invocation; a delegate config
// may override it with its own timeoutMs.
export const DEFAULT_DELEGATE_TIMEOUT_MS = 10 * 60 * 1000

export type DelegateTurnOptions = {
  name: string
  cfg: DelegateConfig
  store: DelegateStore
  sessionKey: string
  prompt: string
  homeCommand: string
  onProgress: (text: string) => void
  signal?: AbortSignal
  cwd?: string
  run?: RunDelegateFn
}

async function runTurn(options: DelegateTurnOptions, resolvedArgs: string[], workDir: string) {
  const run = options.run ?? runDelegate
  return run({
    binary: options.cfg.binary,
    args: resolvedArgs,
    parser: options.cfg.parser,
    onProgress: options.onProgress,
    timeoutMs: options.cfg.timeoutMs ?? DEFAULT_DELEGATE_TIMEOUT_MS,
    ...(options.signal ? { signal: options.signal } : {}),
    cwd: workDir,
  })
}

function failureMessage(name: string, homeCommand: string, err: unknown): string {
  return `${name} failed: ${err instanceof Error ? err.message : String(err)}. Use ${homeCommand} to exit delegation.`
}

export async function startDelegateTurn(options: DelegateTurnOptions): Promise<string> {
  const { name, cfg, store, sessionKey, prompt } = options
  const sessionId = crypto.randomUUID()
  const startSequence = store.beginDelegateStart(sessionKey)
  const resolvedArgs = resolveArgs(cfg.startArgs, { prompt, sessionId })

  const workDir = options.cwd ?? process.cwd()
  const before = snapshotWorktree(workDir)

  let result
  try {
    result = await runTurn(options, resolvedArgs, workDir)
  } catch (err) {
    return failureMessage(name, options.homeCommand, err)
  }

  // Ignore a parser-reported id outside the conservative pattern (design
  // D4) and fall back to the client-generated session id.
  const externalId = result.externalId && isValidExternalId(result.externalId) ? result.externalId : sessionId
  store.setActiveDelegateIfLatest(sessionKey, name, externalId, startSequence)

  const summary = before === null ? null : buildChangeSummary(before, snapshotWorktree(workDir) ?? before, workDir)
  return (result.finalText || `(${name} returned no text response)`) + (summary ?? "")
}

export async function replyDelegateTurn(options: DelegateTurnOptions): Promise<string> {
  const { name, cfg, store, sessionKey, prompt } = options
  const active = store.getActiveDelegate(sessionKey)
  if (!active || active.delegate !== name) {
    throw new Error(`No active ${name} session for this conversation. Call ${name}_start first.`)
  }

  const resolvedArgs = resolveArgs(cfg.replyArgs, { prompt, externalId: active.externalId })

  const workDir = options.cwd ?? process.cwd()
  const before = snapshotWorktree(workDir)

  let result
  try {
    result = await runTurn(options, resolvedArgs, workDir)
  } catch (err) {
    return failureMessage(name, options.homeCommand, err)
  }

  const summary = before === null ? null : buildChangeSummary(before, snapshotWorktree(workDir) ?? before, workDir)
  return (result.finalText || `(${name} returned no text response)`) + (summary ?? "")
}
