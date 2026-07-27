import { existsSync, accessSync, constants } from "fs"
import { join, delimiter, isAbsolute } from "path"
import { fileURLToPath } from "url"
import type { CliDispatchConfig } from "../config"
import { loadConfig, getConfigSearchPaths, DEFAULT_CONFIG } from "../config"
import type { DoctorContext } from "./context"

export interface CheckResult {
  id: string
  label: string
  ok: boolean
  detail: string
  fixHint?: string
}

export const PKG = "opencode-cli-dispatch"

export function resolveConfigPath(ctx: DoctorContext): string | undefined {
  if (ctx.configPath) return ctx.configPath
  return getConfigSearchPaths(undefined, ctx.homeDir, ctx.cwd).find((p) => existsSync(p))
}

export function loadConfigForContext(ctx: DoctorContext): CliDispatchConfig {
  const path = resolveConfigPath(ctx)
  if (!path) return DEFAULT_CONFIG
  return loadConfig(path)
}

export function ownPackageJsonPath(): string {
  return fileURLToPath(new URL("../../package.json", import.meta.url))
}

export function globalCommandsDir(ctx: DoctorContext): string {
  return join(ctx.homeDir, ".config", "opencode", "commands")
}

export function execAccessFlag(): number {
  return process.platform === "win32" ? constants.F_OK : constants.X_OK
}

export function which(binary: string, pathEnv: string): boolean {
  const flag = execAccessFlag()
  const isWin = process.platform === "win32"
  if (isAbsolute(binary)) {
    if (!existsSync(binary)) return false
    try {
      accessSync(binary, flag)
      return true
    } catch {
      return false
    }
  }
  const names = isWin ? [binary, `${binary}.exe`, `${binary}.cmd`, `${binary}.bat`] : [binary]
  for (const name of names) {
    for (const dir of pathEnv.split(delimiter)) {
      if (!dir) continue
      try {
        accessSync(join(dir, name), flag)
        return true
      } catch {
        // not here
      }
    }
  }
  return false
}
