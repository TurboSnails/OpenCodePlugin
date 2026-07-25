// Codex host adapter: translates MCP tool handler calls into the
// host-agnostic delegate-turn module, keyed by the Codex session id recorded
// by the UserPromptSubmit hook (design.md D-store). No abort signal — Codex
// MCP tool calls expose none.
import type { DelegateConfig } from "../config"
import { startDelegateTurn, replyDelegateTurn, type RunDelegateFn } from "../delegate-turn"
import { codexFileDelegateStore, readCurrentSession } from "./session-store"

export type { RunDelegateFn } from "../delegate-turn"

export type CodexDelegateRunOptions = {
  run?: RunDelegateFn
  cwd?: string
  stateDir?: string
  onProgress?: (text: string) => void
}

const HOME_COMMAND = "/prompts:opencode"

function currentSessionKey(stateDir?: string): string {
  const id = readCurrentSession(stateDir)
  if (!id) {
    throw new Error("No active Codex session is known; send any prompt first so the UserPromptSubmit hook records the session id.")
  }
  return id
}

export async function startDelegate(
  name: string,
  cfg: DelegateConfig,
  prompt: string,
  options: CodexDelegateRunOptions = {},
): Promise<string> {
  return startDelegateTurn({
    name,
    cfg,
    store: codexFileDelegateStore(options.stateDir),
    sessionKey: currentSessionKey(options.stateDir),
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
  prompt: string,
  options: CodexDelegateRunOptions = {},
): Promise<string> {
  return replyDelegateTurn({
    name,
    cfg,
    store: codexFileDelegateStore(options.stateDir),
    sessionKey: currentSessionKey(options.stateDir),
    prompt,
    homeCommand: HOME_COMMAND,
    onProgress: options.onProgress ?? (() => {}),
    ...(options.cwd ? { cwd: options.cwd } : {}),
    ...(options.run ? { run: options.run } : {}),
  })
}
