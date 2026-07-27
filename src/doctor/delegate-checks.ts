import { existsSync, mkdtempSync, rmSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"
import type { CliDispatchConfig } from "../config"
import { checkDelegate, type RunDelegateFn } from "../health-check"
import type { DoctorContext } from "./context"
import { type CheckResult, resolveConfigPath, which } from "./check-utils"

export async function checkPluginTools(
  ctx: DoctorContext,
  config: CliDispatchConfig,
  loadTools?: () => Promise<string[]>,
): Promise<CheckResult> {
  const registered = loadTools
    ? await loadTools()
    : await (async () => {
        const { createCliDispatchPlugin } = await import("../index.js")
        const configPath = resolveConfigPath(ctx)
        const tmp = mkdtempSync(join(tmpdir(), "cli-dispatch-doctor-plugin-"))
        try {
          const hooks = await createCliDispatchPlugin(configPath, { commandsDir: tmp })(
            {} as Parameters<ReturnType<typeof createCliDispatchPlugin>>[0],
          )
          return Object.keys(hooks.tool ?? {})
        } finally {
          rmSync(tmp, { recursive: true, force: true })
        }
      })()
  const expected = Object.keys(config.delegates).flatMap((n) => [`${n}_start`, `${n}_reply`, `${n}_check`])
  if (expected.length === 0) {
    return {
      id: "plugin-tools",
      label: "Plugin tools",
      ok: false,
      detail: "no delegates configured",
      fixHint: "Add at least one delegate to cli-dispatch.config.json (see docs/configuration.md), then re-run doctor.",
    }
  }
  const missing = expected.filter((t) => !registered.includes(t))
  if (missing.length === 0) {
    return { id: "plugin-tools", label: "Plugin tools", ok: true, detail: `registered: ${registered.join(", ")}` }
  }
  return {
    id: "plugin-tools",
    label: "Plugin tools",
    ok: false,
    detail: `tools missing after simulated load: ${missing.join(", ")}`,
    fixHint: "Rebuild the plugin (bun run build) and re-run doctor. If it persists, check that dist/ is up to date with src/.",
  }
}

export function checkBinaries(config: CliDispatchConfig, ctx: DoctorContext): CheckResult {
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

export function checkAuthenticated(config: CliDispatchConfig, ctx: DoctorContext): CheckResult {
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

export async function checkWritability(config: CliDispatchConfig, run: RunDelegateFn): Promise<CheckResult> {
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
