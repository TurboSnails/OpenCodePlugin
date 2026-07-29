import { checkDelegationGate } from "../../policy";
import { loadCodexAdapterConfig } from "../config";
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
    const model = input.model;
    const patterns = cfg.verifiedModels;
    const delegate = input.tool_name.replace(/^mcp__cli_dispatch__/, "").replace(/_(start|reply)$/, "");
    const decision = checkDelegationGate({
        target: { kind: "tool", delegate, tool: input.tool_name },
        prompt,
        model,
        verifiedModels: patterns,
        prefix: "[cli-dispatch]",
    });
    if (decision.allow)
        return undefined;
    return {
        hookSpecificOutput: {
            hookEventName: "PreToolUse",
            permissionDecision: "deny",
            permissionDecisionReason: decision.reason,
        },
    };
}
//# sourceMappingURL=pre-tool-use.js.map