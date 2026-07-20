import { loadConfig } from "./config";
import { makeStartTool, makeReplyTool } from "./delegate-tools";
import { makeCheckTool } from "./health-check";
import { makeSystemTransform, makeChatMessage, makeCommandBefore } from "./hooks";
import { generateCommands } from "./commands";
export { loadConfig, resolveArgs } from "./config";
export { makeStartTool, makeReplyTool } from "./delegate-tools";
export { makeSystemTransform, makeChatMessage, makeCommandBefore } from "./hooks";
export { generateCommands } from "./commands";
export { runDelegate, defaultSpawn } from "./run-delegate";
export { getActiveDelegate, setActiveDelegate, clearActiveDelegate } from "./session-store";
export { buildRoutingRule } from "./routing-rule";
export { getParser } from "./parse-events";
export { checkDelegate, makeCheckTool } from "./health-check";
export function createCliDispatchPlugin(configPath, options) {
    return async () => {
        let config;
        try {
            config = loadConfig(configPath);
        }
        catch (err) {
            console.error("[cli-dispatch] Failed to load config:", err);
            config = { delegates: {} };
        }
        if (options?.commandsDir) {
            generateCommands(config, options.commandsDir);
        }
        // Generate tools dynamically from config
        const tools = Object.fromEntries(Object.entries(config.delegates).flatMap(([name, cfg]) => [
            [`${name}_start`, makeStartTool(name, cfg)],
            [`${name}_reply`, makeReplyTool(name, cfg)],
            [`${name}_check`, makeCheckTool(name, cfg)],
        ]));
        return {
            tool: tools,
            "experimental.chat.system.transform": makeSystemTransform(),
            "chat.message": makeChatMessage(),
            "command.execute.before": makeCommandBefore(),
        };
    };
}
// Default export for backwards compatibility
export default createCliDispatchPlugin;
//# sourceMappingURL=index.js.map