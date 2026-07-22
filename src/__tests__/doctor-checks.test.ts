import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, chmodSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"
import { makeContext, runChecks } from "../doctor/checks"
import type { DoctorContext } from "../doctor/checks"

let root: string
let home: string
let cwd: string
let bin: string

// Stub for the delegate runner so the writability probe never spawns a real CLI.
const stubRun: any = async () => ({ text: "ok", externalId: "x" })

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "cli-dispatch-doctor-test-"))
  home = join(root, "home")
  cwd = join(root, "cwd")
  bin = join(root, "bin")
  mkdirSync(home, { recursive: true })
  mkdirSync(cwd, { recursive: true })
  mkdirSync(bin, { recursive: true })
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

function ctx(overrides: Partial<DoctorContext> = {}): DoctorContext {
  return makeContext({ cwd, homeDir: home, pathEnv: bin, ...overrides })
}

function run(ctx: DoctorContext) {
  return runChecks(ctx, stubRun)
}

function writeFakeBinary(dir: string, name: string): void {
  const path = join(dir, name)
  writeFileSync(path, "#!/bin/sh\nexit 0\n")
  chmodSync(path, 0o755)
}

function byId(results: { id: string }[], id: string) {
  return results.find((r) => r.id === id)!
}

describe("runChecks", () => {
  it("reports plugin as registered when a global opencode.json declares it", async () => {
    mkdirSync(join(home, ".config", "opencode"), { recursive: true })
    writeFileSync(
      join(home, ".config", "opencode", "opencode.json"),
      JSON.stringify({ plugin: ["opencode-cli-dispatch@github:TurboSnails/OpenCodePlugin"] }),
    )
    const results = await run(ctx())
    expect(byId(results, "plugin-registered").ok).toBe(true)
  })

  it("reports plugin as registered when a wrapper file references the package", async () => {
    mkdirSync(join(home, ".config", "opencode", "plugins"), { recursive: true })
    writeFileSync(
      join(home, ".config", "opencode", "plugins", "cli-dispatch.ts"),
      'import { createCliDispatchPlugin } from "opencode-cli-dispatch"\nexport default createCliDispatchPlugin()\n',
    )
    const results = await run(ctx())
    expect(byId(results, "plugin-registered").ok).toBe(true)
  })

  it("fails plugin-registered with a fix hint when nothing declares the plugin", async () => {
    const results = await run(ctx())
    const check = byId(results, "plugin-registered")
    expect(check.ok).toBe(false)
    expect(check.fixHint).toContain("opencode-cli-dispatch")
  })

  it("fails config-file when the config JSON is invalid", async () => {
    writeFileSync(join(cwd, "cli-dispatch.config.json"), "{ not json")
    const results = await run(ctx())
    const check = byId(results, "config-file")
    expect(check.ok).toBe(false)
    expect(check.detail).toContain("cli-dispatch.config.json")
  })

  it("passes config-file with a note when no config exists (built-in defaults)", async () => {
    const results = await run(ctx())
    const check = byId(results, "config-file")
    expect(check.ok).toBe(true)
    expect(check.detail).toContain("built-in defaults")
  })

  it("detects delegate binaries on PATH and reports missing ones", async () => {
    writeFakeBinary(bin, "claude")
    const results = await run(ctx())
    const check = byId(results, "delegate-binaries")
    expect(check.ok).toBe(false)
    expect(check.detail).toContain("codex")
    expect(check.detail).not.toContain("claude is missing")
  })

  it("checks credential files only for known CLIs", async () => {
    writeFakeBinary(bin, "claude")
    writeFakeBinary(bin, "codex")
    mkdirSync(join(home, ".codex"), { recursive: true })
    writeFileSync(join(home, ".codex", "auth.json"), "{}")
    const results = await run(ctx())
    const check = byId(results, "cli-authenticated")
    expect(check.ok).toBe(false)
    expect(check.detail).toContain("claude")
    expect(check.detail).not.toContain("codex is not authenticated")
  })

  it("fails slash-commands when the global commands dir is empty", async () => {
    const results = await run(ctx())
    const check = byId(results, "slash-commands")
    expect(check.ok).toBe(false)
  })

  it("runs all six checks in fixed order", async () => {
    const results = await run(ctx())
    expect(results.map((r) => r.id)).toEqual([
      "plugin-registered",
      "config-file",
      "delegate-binaries",
      "cli-authenticated",
      "writability-probe",
      "slash-commands",
    ])
  })
})
