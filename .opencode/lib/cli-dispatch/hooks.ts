import { getActiveDelegate } from "./session-store"
import { buildRoutingRule } from "./routing-rule"

type SystemTransformInput = { sessionID?: string }
type SystemTransformOutput = { system: string[] }

export function makeSystemTransform() {
  return async (input: SystemTransformInput, output: SystemTransformOutput): Promise<void> => {
    const active = input.sessionID ? getActiveDelegate(input.sessionID) : undefined
    if (!active) return
    output.system.push(buildRoutingRule(active.delegate))
  }
}
