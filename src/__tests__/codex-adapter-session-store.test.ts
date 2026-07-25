import { describe, it, expect } from "bun:test"
import { defaultCodexStateDir, codexFileDelegateStore, writeCurrentSession, readCurrentSession } from "../codex-adapter/session-store"
import { mkdtempSync, rmSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"

describe("defaultCodexStateDir", () => {
  it("points under ~/.codex/cli-dispatch", () => {
    expect(defaultCodexStateDir()).toContain(".codex")
    expect(defaultCodexStateDir()).toContain("cli-dispatch")
  })
})

describe("current-session file", () => {
  it("round-trips a session id", () => {
    const dir = mkdtempSync(join(tmpdir(), "codex-session-"))
    writeCurrentSession("thr_abc123", dir)
    expect(readCurrentSession(dir)).toBe("thr_abc123")
    rmSync(dir, { recursive: true, force: true })
  })

  it("rejects invalid session ids", () => {
    const dir = mkdtempSync(join(tmpdir(), "codex-session-"))
    writeCurrentSession("bad id", dir)
    expect(readCurrentSession(dir)).toBeUndefined()
    rmSync(dir, { recursive: true, force: true })
  })
})

describe("codexFileDelegateStore", () => {
  it("persists and clears active delegate under a custom dir", () => {
    const dir = mkdtempSync(join(tmpdir(), "codex-store-"))
    const store = codexFileDelegateStore(dir)
    store.setActiveDelegate("s1", "claude", "ext-123")
    expect(store.getActiveDelegate("s1")).toEqual({ delegate: "claude", externalId: "ext-123" })
    store.clearActiveDelegate("s1")
    expect(store.getActiveDelegate("s1")).toBeUndefined()
    rmSync(dir, { recursive: true, force: true })
  })
})
