import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "fs"
import { homedir } from "os"
import { join } from "path"
import { fileDelegateStore } from "../claude-code-adapter/session-store"
import type { DelegateStore } from "../delegate-store"

// Codex hooks and the MCP server run as separate processes, so delegation
// state lives in files under ~/.codex/cli-dispatch/ (design.md D-store).
// Writes are atomic (write-temp-then-rename).
export function defaultCodexStateDir(): string {
  return join(homedir(), ".codex", "cli-dispatch")
}

export function codexFileDelegateStore(dir: string = defaultCodexStateDir()): DelegateStore {
  return fileDelegateStore(dir)
}

const CURRENT_SESSION_FILE = "current-session"
const SESSION_ID_RE = /^[\w-]+$/

function ensureDir(dir: string): void {
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  try {
    chmodSync(dir, 0o700)
  } catch {}
}

export function writeCurrentSession(sessionId: string, dir: string = defaultCodexStateDir()): void {
  ensureDir(dir)
  const file = join(dir, CURRENT_SESSION_FILE)
  const tmp = `${file}.${process.pid}.tmp`
  writeFileSync(tmp, sessionId, { encoding: "utf-8", mode: 0o600 })
  renameSync(tmp, file)
}

export function readCurrentSession(dir: string = defaultCodexStateDir()): string | undefined {
  try {
    const id = readFileSync(join(dir, CURRENT_SESSION_FILE), "utf-8").trim()
    return SESSION_ID_RE.test(id) ? id : undefined
  } catch {
    return undefined
  }
}
