import { homedir } from "os";
import { join } from "path";
import { tool } from "@opencode-ai/plugin";
import { loadConfig } from "./config";
import { makeStartTool, makeReplyTool } from "./delegate-tools";
import { makeCheckTool } from "./health-check";
import { makeDoctorTool } from "./doctor/tool";
import { makeSystemTransform, makeChatMessage, makeCommandBefore, makeToolExecuteBefore, makeSessionIdle } from "./hooks";
import { generateCommands } from "./commands";
import { writeLoadManifest } from "./load-manifest";
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
export function createCliDispatchPlugin(configPath, options) {
    return async (input) => {
        let tools;
        let config;
        const commandsDir = options?.commandsDir ?? join(homedir(), ".config", "opencode", "commands");
        try {
            config = loadConfig(configPath);
            try {
                generateCommands(config, commandsDir);
            }
            catch (err) {
                console.warn(`[cli-dispatch] could not write slash commands to ${commandsDir}: ${err instanceof Error ? err.message : String(err)}. ` +
                    `Run "cli-dispatch doctor" later to diagnose.`);
            }
            // Generate tools dynamically from config
            tools = {
                ...Object.fromEntries(Object.entries(config.delegates).flatMap(([name, cfg]) => [
                    [`${name}_start`, makeStartTool(name, cfg)],
                    [`${name}_reply`, makeReplyTool(name, cfg)],
                    [`${name}_check`, makeCheckTool(name, cfg)],
                ])),
                cli_dispatch_doctor: makeDoctorTool(),
            };
        }
        catch (err) {
            console.error("[cli-dispatch] Failed to load config:", err);
            // Degrade to diagnostic tools so users can discover why no
            // delegate tools were registered instead of hitting "tool not found".
            config = { delegates: {} };
            tools = { cli_dispatch_status: makeStatusTool(err), cli_dispatch_doctor: makeDoctorTool() };
        }
        try {
            writeLoadManifest({ config, tools: Object.keys(tools), commandsDir, configPath });
        }
        catch (err) {
            console.warn(`[cli-dispatch] could not write load manifest: ${err instanceof Error ? err.message : String(err)}`);
        }
        return {
            tool: tools,
            "experimental.chat.system.transform": makeSystemTransform(),
            "chat.message": makeChatMessage(),
            "command.execute.before": makeCommandBefore(config),
            "tool.execute.before": makeToolExecuteBefore(config),
            event: makeSessionIdle(config, input.client),
        };
    };
}
export function makeStatusTool(err) {
    return tool({
        description: "Report why cli-dispatch registered no delegate tools. The plugin configuration failed to load; call this to see the config file path, the validation errors, and how to fix them.",
        args: {},
        async execute() {
            const message = err instanceof Error ? err.message : String(err);
            return [
                "cli-dispatch failed to load its configuration, so no delegate tools were registered.",
                "",
                message,
                "",
                "Fix: edit the config file above so that every delegate has a valid name (letters, digits, underscore, hyphen), a \"binary\", a \"parser\" (\"claude\", \"codex\", or \"raw\"), \"startArgs\" containing the {prompt} placeholder, and \"replyArgs\". Then restart opencode to reload the plugin.",
            ].join("\n");
        },
    });
}
// Default export for backwards compatibility
export default createCliDispatchPlugin;
//# sourceMappingURL=index.js.map