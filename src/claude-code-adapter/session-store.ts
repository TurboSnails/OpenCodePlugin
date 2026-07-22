import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"
import type { DelegateStore } from "../delegate-store"

export type DelegateSession = {
  delegate: string
  externalId: string
}

// Claude Code hooks and the MCP server run as separate processes per event,
// so delegation state lives in one small JSON file per Claude Code session
// id (design.md D5). Writes are atomic (write-temp-then-rename) so a
// concurrent hook invocation never reads a partial file.
export function defaultStateDir(): string {
  return join(tmpdir(), "cli-dispatch-claude-code")
}

function stateFile(sessionId: string, dir: string): string {
  return join(dir, `${sessionId.replace(/[^\w-]/g, "_")}.json`)
}

function sequenceFile(sessionId: string, dir: string): string {
  return join(dir, `${sessionId.replace(/[^\w-]/g, "_")}.seq.json`)
}

function lockDir(sessionId: string, dir: string): string {
  return join(dir, `${sessionId.replace(/[^\w-]/g, "_")}.lock`)
}

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

function acquireLock(sessionId: string, dir: string): string {
  mkdirSync(dir, { recursive: true })
  const lock = lockDir(sessionId, dir)
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      mkdirSync(lock)
      return lock
    } catch (err) {
      if ((err as { code?: string }).code !== "EEXIST") throw err
      try {
        if (Date.now() - statSync(lock).mtimeMs > 10_000) {
          rmSync(lock, { recursive: true, force: true })
          continue
        }
      } catch {}
      sleepSync(1)
    }
  }
  throw new Error(`Timed out acquiring delegate start lock for session ${sessionId}`)
}

function withSessionLock<T>(sessionId: string, dir: string, fn: () => T): T {
  const lock = acquireLock(sessionId, dir)
  try {
    return fn()
  } finally {
    rmSync(lock, { recursive: true, force: true })
  }
}

function readStartSequence(sessionId: string, dir: string): number {
  try {
    const obj = JSON.parse(readFileSync(sequenceFile(sessionId, dir), "utf-8"))
    return typeof obj?.sequence === "number" ? obj.sequence : 0
  } catch {
    return 0
  }
}

export function beginDelegateStart(sessionId: string, dir: string = defaultStateDir()): number {
  return withSessionLock(sessionId, dir, () => {
    const next = readStartSequence(sessionId, dir) + 1
    const file = sequenceFile(sessionId, dir)
    const tmp = `${file}.${process.pid}.tmp`
    writeFileSync(tmp, JSON.stringify({ sequence: next }), "utf-8")
    renameSync(tmp, file)
    return next
  })
}

export function isLatestDelegateStart(sessionId: string, sequence: number, dir: string = defaultStateDir()): boolean {
  return readStartSequence(sessionId, dir) === sequence
}

export function getActiveDelegate(sessionId: string, dir: string = defaultStateDir()): DelegateSession | undefined {
  try {
    const obj = JSON.parse(readFileSync(stateFile(sessionId, dir), "utf-8"))
    if (typeof obj?.delegate === "string" && typeof obj?.externalId === "string") {
      return { delegate: obj.delegate, externalId: obj.externalId }
    }
    return undefined
  } catch {
    return undefined
  }
}

function writeStateFile(sessionId: string, delegate: string, externalId: string, dir: string): void {
  mkdirSync(dir, { recursive: true })
  const file = stateFile(sessionId, dir)
  const tmp = `${file}.${process.pid}.tmp`
  writeFileSync(tmp, JSON.stringify({ delegate, externalId }), "utf-8")
  renameSync(tmp, file)
}

export function setActiveDelegate(sessionId: string, delegate: string, externalId: string, dir: string = defaultStateDir()): void {
  writeStateFile(sessionId, delegate, externalId, dir)
}

export function clearActiveDelegate(sessionId: string, dir: string = defaultStateDir()): void {
  const file = stateFile(sessionId, dir)
  if (existsSync(file)) rmSync(file)
}

// Atomic check-then-set under the session lock: an earlier start that
// finishes later cannot overwrite a newer delegation (design D6).
export function setActiveDelegateIfLatest(sessionId: string, delegate: string, externalId: string, sequence: number, dir: string = defaultStateDir()): boolean {
  return withSessionLock(sessionId, dir, () => {
    if (readStartSequence(sessionId, dir) !== sequence) return false
    writeStateFile(sessionId, delegate, externalId, dir)
    return true
  })
}

export function fileDelegateStore(dir: string = defaultStateDir()): DelegateStore {
  return {
    getActiveDelegate: (key) => getActiveDelegate(key, dir),
    setActiveDelegate: (key, delegate, externalId) => setActiveDelegate(key, delegate, externalId, dir),
    clearActiveDelegate: (key) => clearActiveDelegate(key, dir),
    beginDelegateStart: (key) => beginDelegateStart(key, dir),
    setActiveDelegateIfLatest: (key, delegate, externalId, sequence) => setActiveDelegateIfLatest(key, delegate, externalId, sequence, dir),
  }
}
