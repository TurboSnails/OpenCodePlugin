import { createHash } from "crypto"
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "fs"
import { homedir } from "os"
import { join } from "path"
import { fileURLToPath } from "url"
import type { CliDispatchConfig } from "./config"

export interface LoadManifest {
  version: string
  pid: number
  cwd: string
  loadedAt: string
  cliDispatchDev: boolean
  configPath?: string
  delegates: string[]
  tools: string[]
  commandsDir: string
}

export interface LoadManifestContext {
  cwd: string
  homeDir: string
}

export function manifestDir(homeDir: string = homedir()): string {
  return join(homeDir, ".local", "share", "opencode", "cli-dispatch")
}

export function manifestPath(cwd: string, homeDir: string = homedir()): string {
  const hash = createHash("sha1").update(cwd).digest("hex").slice(0, 12)
  return join(manifestDir(homeDir), `loaded-${hash}.json`)
}

function ownVersion(): string {
  const pkg = JSON.parse(readFileSync(fileURLToPath(new URL("../package.json", import.meta.url)), "utf-8"))
  return pkg.version
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    return (err as NodeJS.ErrnoException)?.code === "EPERM"
  }
}

export function writeLoadManifest(input: {
  config: CliDispatchConfig
  tools: string[]
  commandsDir: string
  configPath?: string
  cwd?: string
  homeDir?: string
}): LoadManifest {
  const cwd = input.cwd ?? process.cwd()
  const homeDir = input.homeDir ?? homedir()
  const manifest: LoadManifest = {
    version: ownVersion(),
    pid: process.pid,
    cwd,
    loadedAt: new Date().toISOString(),
    cliDispatchDev: process.env.CLI_DISPATCH_DEV === "1",
    configPath: input.configPath,
    delegates: Object.keys(input.config.delegates),
    tools: input.tools,
    commandsDir: input.commandsDir,
  }

  const dir = manifestDir(homeDir)
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  chmodSync(dir, 0o700)
  const path = manifestPath(cwd, homeDir)
  const tmp = `${path}.tmp`
  writeFileSync(tmp, JSON.stringify(manifest, null, 2) + "\n", { encoding: "utf-8", mode: 0o600 })
  chmodSync(tmp, 0o600)
  renameSync(tmp, path)
  return manifest
}

export function readLoadManifest(ctx: LoadManifestContext): LoadManifest | undefined {
  const path = manifestPath(ctx.cwd, ctx.homeDir)
  if (!existsSync(path)) return undefined
  try {
    const parsed = JSON.parse(readFileSync(path, "utf-8")) as LoadManifest
    if (parsed.cwd !== ctx.cwd || typeof parsed.pid !== "number" || typeof parsed.cliDispatchDev !== "boolean") {
      return undefined
    }
    return parsed
  } catch {
    return undefined
  }
}

const MANIFEST_TTL_MS = 24 * 60 * 60 * 1000

export function isManifestFresh(manifest: LoadManifest | undefined, ctx: LoadManifestContext): manifest is LoadManifest {
  if (!manifest || manifest.cwd !== ctx.cwd) return false
  const loadedAtMs = Date.parse(manifest.loadedAt)
  if (Number.isNaN(loadedAtMs) || Date.now() - loadedAtMs > MANIFEST_TTL_MS) return false
  return pidAlive(manifest.pid)
}
