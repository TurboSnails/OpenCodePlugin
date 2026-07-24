import type { Plugin } from "@opencode-ai/plugin";
export type { CliDispatchConfig, DelegateConfig, ParserName } from "./config";
export { loadConfig, resolveArgs } from "./config";
export { makeStartTool, makeReplyTool } from "./delegate-tools";
export { makeSystemTransform, makeChatMessage, makeCommandBefore, makeToolExecuteBefore, makeSessionIdle } from "./hooks";
export { generateCommands } from "./commands";
export { runDelegate, defaultSpawn } from "./run-delegate";
export { getActiveDelegate, setActiveDelegate, clearActiveDelegate } from "./session-store";
export { buildRoutingRule } from "./routing-rule";
export { getParser } from "./parse-events";
export { checkDelegate, makeCheckTool } from "./health-check";
export { makeDoctorTool } from "./doctor/tool";
export declare function createCliDispatchPlugin(configPath?: string, options?: {
    commandsDir?: string;
}): Plugin;
export declare function makeStatusTool(err: unknown): {
    description: string;
    args: {};
    execute(args: Record<string, never>, context: import("@opencode-ai/plugin").ToolContext): Promise<import("@opencode-ai/plugin").ToolResult>;
};
export default createCliDispatchPlugin;
//# sourceMappingURL=index.d.ts.map