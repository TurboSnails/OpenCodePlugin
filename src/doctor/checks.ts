import { existsSync, readFileSync, readdirSync, accessSync, constants, mkdtempSync, rmSync, writeFileSync } from "fs"
import { join, delimiter, isAbsolute } from "path"
import { tmpdir } from "os"
import type { CliDispatchConfig } from "../config"
import { loadConfig, getConfigSearchPaths, DEFAULT_CONFIG } from "../config"
import { checkDelegate, type RunDelegateFn } from "../health-check"
import { generateCommands, GENERATED_MARKER } from "../commands"
import { makeContext, type DoctorContext } from "./context"

export { makeContext, type DoctorContext } from "./context"

export interface CheckResult {
  id: string
  label: string
  ok: boolean
  detail: string
  fixHint?: string
}

const PKG = "opencode-cli-dispatch"

function resolveConfigPath(ctx: DoctorContext): string | undefined {
  if (ctx.configPath) return ctx.configPath
  return getConfigSearchPaths(undefined, ctx.homeDir, ctx.cwd).find((p) => existsSync(p))
}

function loadConfigForContext(ctx: DoctorContext): CliDispatchConfig {
  const path = resolveConfigPath(ctx)
  if (!path) return DEFAULT_CONFIG
  return loadConfig(path)
}

function checkPluginRegistered(ctx: DoctorContext): CheckResult {
  const candidates = [
    join(ctx.cwd, "opencode.json"),
    join(ctx.cwd, "opencode.jsonc"),
    join(ctx.homeDir, ".config", "opencode", "opencode.json"),
    join(ctx.homeDir, ".config", "opencode", "opencode.jsonc"),
  ]
  for (const path of candidates) {
    if (existsSync(path) && readFileSync(path, "utf-8").includes(PKG)) {
      return { id: "plugin-registered", label: "Plugin registered", ok: true, detail: `declared in ${path}` }
    }
  }
  const wrapperDirs = [
    join(ctx.cwd, ".opencode", "plugin"),
    join(ctx.homeDir, ".config", "opencode", "plugins"),
  ]
  for (const dir of wrapperDirs) {
    if (!existsSync(dir)) continue
    for (const file of readdirSync(dir)) {
      if (!/\.(ts|js)$/.test(file)) continue
      if (readFileSync(join(dir, file), "utf-8").includes(PKG)) {
        return { id: "plugin-registered", label: "Plugin registered", ok: true, detail: `wrapper ${join(dir, file)}` }
      }
    }
  }
  return {
    id: "plugin-registered",
    label: "Plugin registered",
    ok: false,
    detail: "no opencode.json(c) plugin entry or plugin wrapper file mentions opencode-cli-dispatch",
    fixHint:
      `Add to opencode.json: { "plugin": ["${PKG}"] } — or create a wrapper file. ` +
      `Run "cli-dispatch doctor --fix" to patch an existing opencode.json automatically.`,
  }
}

function checkConfigFile(ctx: DoctorContext): { result: CheckResult; config: CliDispatchConfig } {
  const found = resolveConfigPath(ctx)
  try {
    const config = loadConfigForContext(ctx)
    if (!found) {
      return {
        result: { id: "config-file", label: "Config file", ok: true, detail: "no config file found; using built-in defaults" },
        config,
      }
    }
    return {
      result: { id: "config-file", label: "Config file", ok: true, detail: `valid config at ${found}` },
      config,
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return {
      result: {
        id: "config-file",
        label: "Config file",
        ok: false,
        detail: message,
        fixHint: "Fix or remove the config file above, then re-run doctor. See docs/configuration.md for the schema.",
      },
      config: { delegates: {} },
    }
  }
}

function which(binary: string, pathEnv: string): boolean {
  if (isAbsolute(binary)) {
    if (!existsSync(binary)) return false
    try {
      accessSync(binary, constants.X_OK)
      return true
    } catch {
      return false
    }
  }
  const names = process.platform === "win32" ? [binary, `${binary}.exe`] : [binary]
  for (const name of names) {
    for (const dir of pathEnv.split(delimiter)) {
      if (!dir) continue
      try {
        accessSync(join(dir, name), constants.X_OK)
        return true
      } catch {
        // not here
      }
    }
  }
  return false
}

function checkBinaries(config: CliDispatchConfig, ctx: DoctorContext): CheckResult {
  const missing = Object.values(config.delegates)
    .map((d) => d.binary)
    .filter((b, i, all) => all.indexOf(b) === i)
    .filter((b) => !which(b, ctx.pathEnv))
  if (missing.length === 0) {
    return { id: "delegate-binaries", label: "Delegate binaries", ok: true, detail: "all delegate binaries found" }
  }
  return {
    id: "delegate-binaries",
    label: "Delegate binaries",
    ok: false,
    detail: `missing on PATH: ${missing.join(", ")}`,
    fixHint: "Install the missing CLIs (e.g. claude: https://docs.anthropic.com/claude-code, codex: npm i -g @openai/codex) and re-run doctor.",
  }
}

function checkAuthenticated(config: CliDispatchConfig, ctx: DoctorContext): CheckResult {
  const problems: string[] = []
  const binaries = new Set(Object.values(config.delegates).map((d) => d.binary))
  for (const b of binaries) {
    if (b === "claude") {
      const okFile =
        existsSync(join(ctx.homeDir, ".claude", ".credentials.json")) ||
        existsSync(join(ctx.homeDir, ".claude.json"))
      if (!okFile) problems.push("claude is not authenticated")
    } else if (b === "codex") {
      if (!existsSync(join(ctx.homeDir, ".codex", "auth.json"))) problems.push("codex is not authenticated")
    }
  }
  if (problems.length === 0) {
    return { id: "cli-authenticated", label: "CLI authentication", ok: true, detail: "credential files present" }
  }
  return {
    id: "cli-authenticated",
    label: "CLI authentication",
    ok: false,
    detail: problems.join("; "),
    fixHint: "Run the CLI once interactively to log in (e.g. `claude` or `codex login`), then re-run doctor.",
  }
}

async function checkWritability(config: CliDispatchConfig, run: RunDelegateFn): Promise<CheckResult> {
  const failures: string[] = []
  for (const [name, cfg] of Object.entries(config.delegates)) {
    const res = await checkDelegate(name, cfg, run)
    if (!res.ok) failures.push(res.detail)
  }
  if (failures.length === 0) {
    return { id: "writability-probe", label: "Writability probe", ok: true, detail: "all delegates created files in an isolated directory" }
  }
  return {
    id: "writability-probe",
    label: "Writability probe",
    ok: false,
    detail: failures.join("; "),
    fixHint: "Check the permission/sandbox flags in cli-dispatch.config.json (see docs/configuration.md#delegate-permissions).",
  }
}

function globalCommandsDir(ctx: DoctorContext): string {
  return join(ctx.homeDir, ".config", "opencode", "commands")
}

function checkSlashCommands(config: CliDispatchConfig, ctx: DoctorContext): CheckResult {
  const dir = globalCommandsDir(ctx)
  const tmp = mkdtempSync(join(tmpdir(), "cli-dispatch-doctor-cmds-"))
  try {
    generateCommands(config, tmp)
    const expected = readdirSync(tmp)
      .filter((f) => f.endsWith(".md"))
      .filter((file) => {
        const target = join(dir, file)
        // Hand-maintained files (no generated marker) are not managed by us.
        if (!existsSync(target)) return true
        return readFileSync(target, "utf-8").includes(GENERATED_MARKER)
      })
    const stale: string[] = []
    for (const file of expected) {
      const target = join(dir, file)
      if (!existsSync(target) || readFileSync(target, "utf-8") !== readFileSync(join(tmp, file), "utf-8")) {
        stale.push(file)
      }
    }
    if (stale.length === 0) {
      return { id: "slash-commands", label: "Slash commands", ok: true, detail: `up to date in ${dir}` }
    }
    return {
      id: "slash-commands",
      label: "Slash commands",
      ok: false,
      detail: `missing or stale in ${dir}: ${stale.join(", ")}`,
      fixHint: 'Run "cli-dispatch doctor --fix" to regenerate them.',
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
}

export async function runChecks(ctx: DoctorContext, run: RunDelegateFn): Promise<CheckResult[]> {
  const results: CheckResult[] = []
  let config: CliDispatchConfig = { delegates: {} }

  const safe = async (
    id: string,
    label: string,
    fn: () => CheckResult | Promise<CheckResult>,
  ): Promise<CheckResult> => {
    try {
      return await fn()
    } catch (err) {
      return {
        id,
        label,
        ok: false,
        detail: err instanceof Error ? err.message : String(err),
      }
    }
  }

  results.push(await safe("plugin-registered", "Plugin registered", () => checkPluginRegistered(ctx)))

  const configOutcome = await safe("config-file", "Config file", () => checkConfigFile(ctx).result)
  // config needs to be loaded outside safe() so subsequent checks can use it
  try {
    config = loadConfigForContext(ctx)
  } catch {
    config = { delegates: {} }
  }
  results.push(configOutcome)

  results.push(await safe("delegate-binaries", "Delegate binaries", () => checkBinaries(config, ctx)))
  results.push(await safe("cli-authenticated", "CLI authentication", () => checkAuthenticated(config, ctx)))
  results.push(await safe("writability-probe", "Writability probe", () => checkWritability(config, run)))
  results.push(await safe("slash-commands", "Slash commands", () => checkSlashCommands(config, ctx)))

  return results
}

export function applyFixes(results: CheckResult[], ctx: DoctorContext): CheckResult[] {
  return results.map((r) => {
    if (r.ok) return r
    if (r.id === "slash-commands") {
      try {
        const config = loadConfigForContext(ctx)
        generateCommands(config, globalCommandsDir(ctx))
        return { ...r, ok: true, detail: `regenerated into ${globalCommandsDir(ctx)}` }
      } catch (err) {
        return { ...r, detail: `${r.detail} (fix failed: ${err instanceof Error ? err.message : String(err)})` }
      }
    }
    if (r.id === "plugin-registered") {
      const candidates = [
        join(ctx.cwd, "opencode.json"),
        join(ctx.cwd, "opencode.jsonc"),
        join(ctx.homeDir, ".config", "opencode", "opencode.json"),
        join(ctx.homeDir, ".config", "opencode", "opencode.jsonc"),
      ]
      for (const path of candidates) {
        if (!existsSync(path)) continue
        try {
          if (path.endsWith(".jsonc")) {
            const text = readFileSync(path, "utf-8")
            if (text.includes(PKG)) {
              return { ...r, ok: true, detail: `plugin already declared in ${path}` }
            }
            const pluginMatch = text.match(/"plugin"\s*:\s*\[([\s\S]*?)\]/)
            if (!pluginMatch) continue
            const fullMatch = pluginMatch[0]
            const arrayContent = pluginMatch[1]
            const closeIndex = fullMatch.lastIndexOf("]")
            const separator = arrayContent.trim().length > 0 ? ", " : ""
            const replacement = `${fullMatch.slice(0, closeIndex)}${separator}"${PKG}"${fullMatch.slice(closeIndex)}`
            writeFileSync(path, text.replace(fullMatch, replacement), "utf-8")
            return { ...r, ok: true, detail: `added "${PKG}" to plugin array in ${path}` }
          }
          const obj = JSON.parse(readFileSync(path, "utf-8"))
          const plugins: string[] = Array.isArray(obj.plugin) ? obj.plugin : []
          if (!plugins.some((p) => typeof p === "string" && p.includes(PKG))) {
            obj.plugin = [...plugins, PKG]
            writeFileSync(path, JSON.stringify(obj, null, 2) + "\n", "utf-8")
          }
          return { ...r, ok: true, detail: `added "${PKG}" to plugin array in ${path}` }
        } catch {
          // fall through to next candidate / report-only
        }
      }
      return { ...r, detail: `${r.detail} (no writable opencode.json(c) found to patch — apply the fixHint manually)` }
    }
    return r
  })
}
