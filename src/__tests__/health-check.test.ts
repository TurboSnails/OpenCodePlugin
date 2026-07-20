import { describe, it, expect } from "bun:test"
import { writeFileSync, existsSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"
import { checkDelegate } from "../health-check"
import type { DelegateConfig } from "../config"
import type { runDelegate } from "../run-delegate"

type RunDelegateFn = typeof runDelegate

const CFG: DelegateConfig = {
  binary: "fakecli",
  parser: "raw",
  startArgs: ["--", "{prompt}"],
  replyArgs: ["--", "{prompt}"],
}

describe("checkDelegate", () => {
  it("passes when the delegate creates a file in the temp dir", async () => {
    const run: RunDelegateFn = async (options) => {
      writeFileSync(join(options.cwd!, "healthcheck.txt"), "ok")
      return { finalText: "done", stderrText: "" }
    }
    const result = await checkDelegate("fakecli", CFG, run)
    expect(result.ok).toBe(true)
    expect(result.detail).toContain("writable")
  })

  it("fails with a permission hint when the delegate creates nothing", async () => {
    const run: RunDelegateFn = async () => ({ finalText: "I cannot edit files", stderrText: "" })
    const result = await checkDelegate("fakecli", CFG, run)
    expect(result.ok).toBe(false)
    expect(result.detail).toContain("created no files")
    expect(result.detail).toContain("read-only")
  })

  it("fails with the error message when the run times out", async () => {
    const run: RunDelegateFn = async () => {
      throw new Error("fakecli timed out after 120000ms")
    }
    const result = await checkDelegate("fakecli", CFG, run)
    expect(result.ok).toBe(false)
    expect(result.detail).toContain("timed out")
    expect(result.detail).toContain("read-only")
  })

  it("runs in an isolated tmpdir and cleans it up afterwards", async () => {
    let usedCwd: string | undefined
    const run: RunDelegateFn = async (options) => {
      usedCwd = options.cwd
      writeFileSync(join(options.cwd!, "healthcheck.txt"), "ok")
      return { finalText: "done", stderrText: "" }
    }
    const result = await checkDelegate("fakecli", CFG, run)
    expect(result.ok).toBe(true)
    expect(usedCwd).toBeDefined()
    expect(usedCwd!.startsWith(tmpdir())).toBe(true)
    expect(usedCwd!).not.toBe(process.cwd())
    expect(existsSync(usedCwd!)).toBe(false)
  })
})
