import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { mkdtempSync, mkdirSync, rmSync, symlinkSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"

let root: string
let home: string
let cwd: string
let cleanPath: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "cli-dispatch-doctor-cli-"))
  home = join(root, "home")
  cwd = join(root, "cwd")
  mkdirSync(home, { recursive: true })
  mkdirSync(cwd, { recursive: true })
  // Clean PATH that contains only `bun` (symlinked to process.execPath) so the
  // CLI never finds claude/codex and the writability probe fails fast without
  // calling a real CLI.
  cleanPath = join(root, "clean-path")
  mkdirSync(cleanPath, { recursive: true })
  symlinkSync(process.execPath, join(cleanPath, "bun"))
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

const CLI = join(import.meta.dir, "..", "doctor", "cli.ts")

function runDoctorCli(): { exitCode: number; stdout: string } {
  const proc = Bun.spawnSync(["bun", "run", CLI], {
    cwd,
    env: { ...process.env, HOME: home, PATH: cleanPath },
    stdout: "pipe",
    stderr: "pipe",
  })
  return { exitCode: proc.exitCode, stdout: proc.stdout.toString() }
}

describe("doctor CLI", () => {
  it("exits 1 and marks failures with ✗ in a bare environment", () => {
    const { exitCode, stdout } = runDoctorCli()
    expect(exitCode).toBe(1)
    expect(stdout).toContain("✗")
    expect(stdout).toContain("plugin-registered")
  }, 30_000)
})
