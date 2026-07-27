import { existsSync, readFileSync, readdirSync, mkdtempSync, rmSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"
import type { CliDispatchConfig } from "../config"
import { generateCommands, GENERATED_MARKER } from "../commands"
import type { DoctorContext } from "./context"
import { type CheckResult, globalCommandsDir, loadConfigForContext } from "./check-utils"

export function checkSlashCommands(config: CliDispatchConfig, ctx: DoctorContext): CheckResult {
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

export function fixSlashCommands(r: CheckResult, ctx: DoctorContext): CheckResult {
  try {
    const config = loadConfigForContext(ctx)
    generateCommands(config, globalCommandsDir(ctx))
    return { ...r, ok: true, detail: `regenerated into ${globalCommandsDir(ctx)}` }
  } catch (err) {
    return { ...r, detail: `${r.detail} (fix failed: ${err instanceof Error ? err.message : String(err)})` }
  }
}
