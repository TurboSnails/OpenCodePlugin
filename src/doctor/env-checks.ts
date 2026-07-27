import { existsSync, readFileSync, readdirSync, writeFileSync } from "fs"
import { join } from "path"
import { spawnSync } from "child_process"
import type { CliDispatchConfig } from "../config"
import type { DoctorContext } from "./context"
import { type CheckResult, PKG, resolveConfigPath, loadConfigForContext, ownPackageJsonPath, which } from "./check-utils"

export function checkPluginRegistered(ctx: DoctorContext): CheckResult {
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

export function checkOpencodeCompat(ctx: DoctorContext): CheckResult {
  if (!which("opencode", ctx.pathEnv)) {
    return { id: "opencode-compat", label: "OpenCode compatibility", ok: true, detail: "opencode not on PATH; skipped" }
  }
  const res = spawnSync("opencode", ["--version"], {
    encoding: "utf-8",
    timeout: 5000,
    env: { ...process.env, PATH: ctx.pathEnv },
  })
  const opencodeVersion = (res.stdout ?? "").trim()
  if (!/^\d+\.\d+\.\d+/.test(opencodeVersion)) {
    return { id: "opencode-compat", label: "OpenCode compatibility", ok: true, detail: `could not parse opencode version (${opencodeVersion}); skipped` }
  }
  const pkg = JSON.parse(readFileSync(ownPackageJsonPath(), "utf-8"))
  const supported: string = pkg.devDependencies?.["@opencode-ai/plugin"] ?? ""
  const [oMaj, oMin] = opencodeVersion.split(".")
  const [sMaj, sMin] = supported.replace(/^[^\d]*/, "").split(".")
  if (oMaj === sMaj && oMin === sMin) {
    return { id: "opencode-compat", label: "OpenCode compatibility", ok: true, detail: `opencode ${opencodeVersion} matches plugin API ${supported}` }
  }
  return {
    id: "opencode-compat",
    label: "OpenCode compatibility",
    ok: false,
    detail: `opencode ${opencodeVersion} vs plugin API ${supported} (minor mismatch)`,
    fixHint: `Align the devDependency: set "@opencode-ai/plugin" to "${opencodeVersion}" in package.json, run bun install && bun run build, then restart opencode.`,
  }
}

export function checkConfigFile(ctx: DoctorContext): { result: CheckResult; config: CliDispatchConfig } {
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

function stripJsoncComments(text: string): string {
  // Remove single-line comments that are not inside strings.
  const withoutLineComments = text.replace(/(^|[^:"'])(\/\/[^\r\n]*)/g, "$1")
  // Remove multi-line comments.
  const withoutBlockComments = withoutLineComments.replace(/\/\*[\s\S]*?\*\//g, "")
  return withoutBlockComments
}

export function fixPluginRegistration(r: CheckResult, ctx: DoctorContext): CheckResult {
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
        const stripped = stripJsoncComments(text)
        let obj: Record<string, unknown>
        try {
          obj = JSON.parse(stripped)
        } catch {
          return {
            ...r,
            detail: `${r.detail} (unsupported JSONC structure in ${path} — please add "${PKG}" to the plugin array manually)`,
          }
        }
        const plugins: string[] = Array.isArray(obj.plugin) ? (obj.plugin as string[]) : []
        if (!plugins.some((p) => typeof p === "string" && p.includes(PKG))) {
          obj.plugin = [...plugins, PKG]
        }
        writeFileSync(path, JSON.stringify(obj, null, 2) + "\n", "utf-8")
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
