// .opencode/plugin/cli-dispatch.ts
import type { Plugin } from "@opencode-ai/plugin"
import { DELEGATES, makeStartTool, makeReplyTool } from "../lib/cli-dispatch/delegate-tools"

const CliDispatchPlugin: Plugin = async () => {
  return {
    tool: Object.fromEntries(
      Object.values(DELEGATES).flatMap((cfg) => [
        [`${cfg.name}_start`, makeStartTool(cfg)],
        [`${cfg.name}_reply`, makeReplyTool(cfg)],
      ]),
    ),
  }
}

export default CliDispatchPlugin
