import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, statSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"
import {
  writeLoadManifest,
  readLoadManifest,
  isManifestFresh,
  manifestPath,
  type LoadManifest,
} from "../load-manifest"
import type { CliDispatchConfig } from "../config"

let root: string
let home: string
let cwd: string
let originalDev: string | undefined

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "cli-dispatch-manifest-test-"))
  home = join(root, "home")
  cwd = join(root, "cwd")
  originalDev = process.env.CLI_DISPATCH_DEV
})

afterEach(() => {
  if (originalDev === undefined) delete process.env.CLI_DISPATCH_DEV
  else process.env.CLI_DISPATCH_DEV = originalDev
  rmSync(root, { recursive: true, force: true })
})

function config(): CliDispatchConfig {
  return {
    delegates: {
      claude: { binary: "claude", parser: "claude", startArgs: ["{prompt}"], replyArgs: ["{prompt}"] },
    },
  }
}

describe("load manifest", () => {
  it("writes and reads a fresh manifest with server env truth", () => {
    process.env.CLI_DISPATCH_DEV = "1"
    const written = writeLoadManifest({
      config: config(),
      tools: ["claude_start", "cli_dispatch_doctor"],
      commandsDir: join(home, ".config", "opencode", "commands"),
      configPath: join(cwd, "cli-dispatch.config.json"),
      cwd,
      homeDir: home,
    })

    const path = manifestPath(cwd, home)
    expect(existsSync(path)).toBe(true)
    expect(statSync(path).mode & 0o777).toBe(0o600)
    expect(written.cliDispatchDev).toBe(true)

    const read = readLoadManifest({ cwd, homeDir: home })
    expect(read).toEqual(written)
    expect(isManifestFresh(read, { cwd, homeDir: home })).toBe(true)
  })

  it("treats a manifest with a dead pid as stale", () => {
    const manifest = writeLoadManifest({
      config: config(),
      tools: ["claude_start"],
      commandsDir: join(home, "commands"),
      cwd,
      homeDir: home,
    })
    const stale: LoadManifest = { ...manifest, pid: 99999999 }

    expect(isManifestFresh(stale, { cwd, homeDir: home })).toBe(false)
  })

  it("treats a manifest older than 24h as stale even with a live pid", () => {
    const manifest = writeLoadManifest({
      config: config(),
      tools: ["claude_start"],
      commandsDir: join(home, "commands"),
      cwd,
      homeDir: home,
    })
    const old: LoadManifest = { ...manifest, loadedAt: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString() }
    expect(isManifestFresh(old, { cwd, homeDir: home })).toBe(false)
  })

  it("treats a manifest with an invalid loadedAt as stale even with a live pid", () => {
    const manifest = writeLoadManifest({
      config: config(),
      tools: ["claude_start"],
      commandsDir: join(home, "commands"),
      cwd,
      homeDir: home,
    })
    const invalid: LoadManifest = { ...manifest, loadedAt: "not a date" }
    expect(isManifestFresh(invalid, { cwd, homeDir: home })).toBe(false)
  })

  it("returns undefined for missing, wrong-cwd, or malformed manifests", () => {
    expect(readLoadManifest({ cwd, homeDir: home })).toBeUndefined()

    const other = writeLoadManifest({
      config: config(),
      tools: ["claude_start"],
      commandsDir: join(home, "commands"),
      cwd: join(root, "other"),
      homeDir: home,
    })
    expect(readLoadManifest({ cwd, homeDir: home })).toBeUndefined()
    expect(isManifestFresh(other, { cwd, homeDir: home })).toBe(false)

    writeFileSync(manifestPath(cwd, home), "{ not json")
    expect(readLoadManifest({ cwd, homeDir: home })).toBeUndefined()
  })

  it("throws when the manifest dir cannot be created", () => {
    const fileHome = join(root, "file-home")
    writeFileSync(fileHome, "not a dir")
    expect(() =>
      writeLoadManifest({
        config: config(),
        tools: ["claude_start"],
        commandsDir: join(root, "commands"),
        cwd,
        homeDir: fileHome,
      }),
    ).toThrow()
  })
})
