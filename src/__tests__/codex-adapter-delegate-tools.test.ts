import { describe, it, expect } from "bun:test"
import { startDelegate, replyDelegate } from "../codex-adapter/delegate-tools"
import { writeCurrentSession, codexFileDelegateStore } from "../codex-adapter/session-store"
import { mkdtempSync, rmSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"
import type { DelegateConfig } from "../config"

const cfg: DelegateConfig = {
  binary: "fake",
  parser: "raw",
  startArgs: ["--", "{prompt}"],
  replyArgs: ["--", "{externalId}", "{prompt}"],
}

describe("startDelegate", () => {
  it("throws when no current session is recorded", async () => {
    const dir = mkdtempSync(join(tmpdir(), "codex-delegate-"))
    await expect(startDelegate("claude", cfg, "hello", { stateDir: dir })).rejects.toThrow(/No active Codex session/)
    rmSync(dir, { recursive: true, force: true })
  })

  it("passes the recorded session id to the store", async () => {
    const dir = mkdtempSync(join(tmpdir(), "codex-delegate-"))
    writeCurrentSession("sess-1", dir)
    const seen: string[] = []
    const result = await startDelegate("claude", cfg, "hello", {
      stateDir: dir,
      run: async () => {
        seen.push("run")
        return { finalText: "ok", externalId: "ext-1234", stderrText: "" }
      },
    })
    expect(result).toContain("ok")
    expect(seen).toEqual(["run"])
    expect(codexFileDelegateStore(dir).getActiveDelegate("sess-1")).toEqual({ delegate: "claude", externalId: "ext-1234" })
    rmSync(dir, { recursive: true, force: true })
  })
})

describe("replyDelegate", () => {
  it("resumes the active session for the recorded session id", async () => {
    const dir = mkdtempSync(join(tmpdir(), "codex-delegate-"))
    writeCurrentSession("sess-1", dir)
    await startDelegate("claude", cfg, "hello", {
      stateDir: dir,
      run: async () => ({ finalText: "ok", externalId: "ext-1234", stderrText: "" }),
    })
    const prompts: string[] = []
    const result = await replyDelegate("claude", cfg, "again", {
      stateDir: dir,
      run: async (opts) => {
        prompts.push(opts.args.join(" "))
        return { finalText: "replied", externalId: "ext-1234", stderrText: "" }
      },
    })
    expect(result).toContain("replied")
    expect(prompts[0]).toContain("ext-1234")
    rmSync(dir, { recursive: true, force: true })
  })
})
