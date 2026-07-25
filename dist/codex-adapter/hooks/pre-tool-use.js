import { GENERATED_MARKER } from "../../policy";
import { matchesModelPattern, loadCodexAdapterConfig } from "../config";
import { MCP_SERVER_NAME } from "../constants";
function mcpToolName(delegate, kind) {
    return `mcp__${MCP_SERVER_NAME}__${delegate}_${kind}`;
}
export function handlePreToolUse(input, config) {
    const cfg = config ?? loadCodexAdapterConfig();
    const delegateTools = new Set(Object.keys(cfg.delegates).flatMap((name) => [mcpToolName(name, "start"), mcpToolName(name, "reply")]));
    if (!input.tool_name || !delegateTools.has(input.tool_name))
        return undefined;
    const prompt = input.tool_input?.prompt;
    if (typeof prompt === "string" && prompt.includes(GENERATED_MARKER)) {
        return {
            hookSpecificOutput: {
                hookEventName: "PreToolUse",
                permissionDecision: "deny",
                permissionDecisionReason: `${input.tool_name} rejected: the "prompt" argument contains the whole delegate command template instead of the user's actual message. Pass only the user's text as "prompt".`,
            },
        };
    }
    const patterns = cfg.verifiedModels;
    if (!patterns || patterns.length === 0)
        return undefined;
    const model = input.model;
    if (!model)
        return undefined;
    if (matchesModelPattern(model, patterns))
        return undefined;
    return {
        hookSpecificOutput: {
            hookEventName: "PreToolUse",
            permissionDecision: "deny",
            permissionDecisionReason: `[cli-dispatch] The current model (${model}) is not on the verified-models allow-list for CLI delegation, so ${input.tool_name} was blocked. Switch to a verified model and try again.`,
        },
    };
}
//# sourceMappingURL=pre-tool-use.js.map