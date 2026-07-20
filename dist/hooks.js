import { getActiveDelegate, clearActiveDelegate, setSessionAgent } from "./session-store";
import { buildRoutingRule } from "./routing-rule";
export function makeSystemTransform() {
    return async (input, output) => {
        const active = input.sessionID ? getActiveDelegate(input.sessionID) : undefined;
        if (!active)
            return;
        output.system.push(buildRoutingRule(active.delegate));
    };
}
export const MENTION_BOILERPLATE = /^\s*Use the above message and context to generate a prompt and call the task tool with subagent:\s*[\w-]+\s*\.?\s*$/;
export function rewriteMentionBoilerplate(parts) {
    const mention = parts.find((p) => p.type === "agent" && typeof p.name === "string");
    if (!mention || !mention.name)
        return;
    for (const part of parts) {
        if (part.type === "text" && typeof part.text === "string" && MENTION_BOILERPLATE.test(part.text)) {
            part.text = `The user mentioned the "${mention.name}" agent for the following request:`;
        }
    }
}
export function makeChatMessage() {
    return async (input, output) => {
        if (input.agent)
            setSessionAgent(input.sessionID, input.agent);
        const active = getActiveDelegate(input.sessionID);
        if (!active)
            return;
        rewriteMentionBoilerplate(output.parts);
    };
}
export function makeCommandBefore() {
    return async (input, output) => {
        if (input.command !== "opencode")
            return;
        const active = getActiveDelegate(input.sessionID);
        clearActiveDelegate(input.sessionID);
        const note = active
            ? `[plugin] Cleared the active ${active.delegate} delegation for this session.`
            : "[plugin] No CLI delegation was active for this session.";
        output.parts.push({ type: "text", text: note, synthetic: true });
    };
}
//# sourceMappingURL=hooks.js.map