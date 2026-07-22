// Claude Code host adapter: translates MCP tool handler calls into the
// host-agnostic delegate-turn module (design D6), keyed by the Claude Code
// session id and backed by the file store. No abort signal — Claude Code
// MCP tool calls expose none.
import type { DelegateConfig } from "../config"
import { startDelegateTurn, replyDelegateTurn, type RunDelegateFn } from "../delegate-turn"
import { fileDelegateStore } from "./session-store"

export type { RunDelegateFn } from "../delegate-turn"

export type DelegateRunOptions = {
  run?: RunDelegateFn
  cwd?: string
  stateDir?: string
  onProgress?: (text: string) => void
}

const HOME_COMMAND = "/cc"

export async function startDelegate(
  name: string,
  cfg: DelegateConfig,
  claudeSessionId: string,
  prompt: string,
  options: DelegateRunOptions = {},
): Promise<string> {
  return startDelegateTurn({
    name,
    cfg,
    store: fileDelegateStore(options.stateDir),
    sessionKey: claudeSessionId,
    prompt,
    homeCommand: HOME_COMMAND,
    onProgress: options.onProgress ?? (() => {}),
    ...(options.cwd ? { cwd: options.cwd } : {}),
    ...(options.run ? { run: options.run } : {}),
  })
}

export async function replyDelegate(
  name: string,
  cfg: DelegateConfig,
  claudeSessionId: string,
  prompt: string,
  options: DelegateRunOptions = {},
): Promise<string> {
  return replyDelegateTurn({
    name,
    cfg,
    store: fileDelegateStore(options.stateDir),
    sessionKey: claudeSessionId,
    prompt,
    homeCommand: HOME_COMMAND,
    onProgress: options.onProgress ?? (() => {}),
    ...(options.cwd ? { cwd: options.cwd } : {}),
    ...(options.run ? { run: options.run } : {}),
  })
}
