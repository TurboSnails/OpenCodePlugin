import { tool } from "@opencode-ai/plugin"
import { runChecks } from "./checks"
import { makeContext, type DoctorContext } from "./context"
import { formatResults } from "./format"
import { runDelegate } from "../run-delegate"
import type { RunDelegateFn } from "../health-check"

export function makeDoctorTool(run: RunDelegateFn = runDelegate, overrides: Partial<DoctorContext> = {}) {
  return tool({
    description:
      "Diagnose the cli-dispatch installation: plugin registration, config file validity, delegate binaries on PATH, CLI authentication, writability probe, and slash command freshness. Returns one line per check with a fix hint for the first failure.",
    args: {},
    async execute(_args, context) {
      const ctx = makeContext({ cwd: context.directory ?? process.cwd(), ...overrides })
      const results = await runChecks(ctx, run)
      return formatResults(results)
    },
  })
}
