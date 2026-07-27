import type { Plugin } from "@opencode-ai/plugin"
import { createCliDispatchPlugin } from "./index"

export function createLocalCliDispatchPlugin(
  configPath?: string,
  options?: { commandsDir?: string },
): Plugin {
  if (process.env.CLI_DISPATCH_DEV !== "1") {
    return async () => ({})
  }
  return createCliDispatchPlugin(configPath, options)
}
