import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"

export type DelegateSession = {
  delegate: string
  externalId: string
}

type StoredState = {
  delegate?: DelegateSession
}

const STATE_DIR = join(tmpdir(), "cli-dispatch-claude-code-adapter")

function statePath(sessionId: string): string {
  return join(STATE_DIR, `${sessionId}.json`)
}

function readState(sessionId: string): StoredState {
  const path = statePath(sessionId)
  if (!existsSync(path)) return {}
  try {
    return JSON.parse(readFileSync(path, "utf-8"))
  } catch {
    return {}
  }
}

function writeState(sessionId: string, state: StoredState): void {
  mkdirSync(STATE_DIR, { recursive: true })
  const path = statePath(sessionId)
  const tmpPath = `${path}.tmp-${process.pid}`
  writeFileSync(tmpPath, JSON.stringify(state))
  renameSync(tmpPath, path)
}

export function getActiveDelegate(sessionId: string): DelegateSession | undefined {
  return readState(sessionId).delegate
}

export function setActiveDelegate(sessionId: string, delegate: string, externalId: string): void {
  const state = readState(sessionId)
  state.delegate = { delegate, externalId }
  writeState(sessionId, state)
}

export function clearActiveDelegate(sessionId: string): void {
  const state = readState(sessionId)
  delete state.delegate
  writeState(sessionId, state)
}
