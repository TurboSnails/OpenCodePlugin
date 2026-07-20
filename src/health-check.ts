import { mkdtempSync, readdirSync, rmSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"
import { tool } from "@opencode-ai/plugin"
import type { DelegateConfig } from "./config"
import { resolveArgs } from "./config"
import { runDelegate } from "./run-delegate"

export type RunDelegateFn = typeof runDelegate

export type HealthCheckResult = {
  ok: boolean
  detail: string
}

const CHECK_PROMPT = "Create a file named healthcheck.txt containing the word ok, then stop."
const CHECK_TIMEOUT_MS = 120_000

export function checkDelegate(
  name: string,
  cfg: DelegateConfig,
  run: RunDelegateFn = runDelegate,
): Promise<HealthCheckResult> {
  const dir = mkdtempSync(join(tmpdir(), `cli-dispatch-check-${name}-`))
  return runCheck(name, cfg, dir, run).finally(() => {
    rmSync(dir, { recursive: true, force: true })
  })
}

async function runCheck(
  name: string,
  cfg: DelegateConfig,
  dir: string,
  run: RunDelegateFn,
): Promise<HealthCheckResult> {
  const args = resolveArgs(cfg.startArgs, {
    prompt: CHECK_PROMPT,
    sessionId: crypto.randomUUID(),
  })

  try {
    await run({
      binary: cfg.binary,
      args,
      parser: cfg.parser,
      onProgress: () => {},
      cwd: dir,
      timeoutMs: CHECK_TIMEOUT_MS,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return {
      ok: false,
      detail:
        `${name} health check failed: ${message}. ` +
        `The delegate's permission/sandbox flags in cli-dispatch.config.json may be read-only.`,
    }
  }

  const created = readdirSync(dir)
  if (created.length > 0) {
    return { ok: true, detail: `${name} is writable (created: ${created.join(", ")})` }
  }

  return {
    ok: false,
    detail:
      `${name} ran but created no files in an isolated directory. ` +
      `The delegate's permission/sandbox flags in cli-dispatch.config.json may be read-only.`,
  }
}

export function makeCheckTool(
  name: string,
  cfg: DelegateConfig,
  run: RunDelegateFn = runDelegate,
) {
  return tool({
    description: `Verify that the ${name} CLI delegate can write files when spawned with its configured arguments. Runs ${name} in an isolated temporary directory; does not touch the workspace.`,
    args: {},
    async execute() {
      const result = await checkDelegate(name, cfg, run)
      return result.ok ? `OK: ${result.detail}` : `FAIL: ${result.detail}`
    },
  })
}
