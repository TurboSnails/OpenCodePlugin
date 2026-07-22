import { getActiveDelegate, clearActiveDelegate, setSessionAgent, setSessionModel, getSessionModel } from "./session-store";
import { buildRoutingRule } from "./routing-rule";
import { matchesVerifiedModel } from "./config";
import { GENERATED_MARKER } from "./policy";
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
        if (input.model)
            setSessionModel(input.sessionID, input.model);
        const active = getActiveDelegate(input.sessionID);
        if (!active)
            return;
        rewriteMentionBoilerplate(output.parts);
    };
}
// Generated delegate commands declare their target structurally in
// frontmatter (`delegate: <name>`), so detection is a parse of that
// declaration — not a substring match for `{name}_start`, which any
// hand-written text could trip (design D6). The slash command's own name is
// not authoritative (this repo's `/cc` targets the `claude` delegate).
function detectTargetedDelegate(parts, delegateNames) {
    const text = parts.map((p) => p.text ?? "").join("\n");
    const frontmatter = text.match(/^---\n([\s\S]*?)\n---/);
    if (!frontmatter)
        return undefined;
    const declaration = frontmatter[1].match(/^delegate:\s*([\w-]+)\s*$/m);
    if (!declaration)
        return undefined;
    return delegateNames.includes(declaration[1]) ? declaration[1] : undefined;
}
export function makeCommandBefore(config) {
    return async (input, output) => {
        if (input.command === "opencode") {
            const active = getActiveDelegate(input.sessionID);
            clearActiveDelegate(input.sessionID);
            const note = active
                ? `[plugin] Cleared the active ${active.delegate} delegation for this session.`
                : "[plugin] No CLI delegation was active for this session.";
            output.parts.push({ type: "text", text: note, synthetic: true });
            return;
        }
        const patterns = config.verifiedModels;
        if (!patterns || patterns.length === 0)
            return;
        const delegate = detectTargetedDelegate(output.parts, Object.keys(config.delegates));
        if (!delegate)
            return;
        const model = getSessionModel(input.sessionID);
        if (!model)
            return; // unknown model: fail open (see design.md D2)
        if (matchesVerifiedModel(model, patterns))
            return;
        output.parts.length = 0;
        output.parts.push({
            type: "text",
            text: `[plugin] The current model (${model.providerID}/${model.modelID}) is not on the verified-models allow-list for CLI delegation, so ${delegate} was not started. Switch to a verified model and try again.`,
            synthetic: true,
        });
    };
}
export function makeToolExecuteBefore(config) {
    const delegateToolNames = new Set(Object.keys(config.delegates).flatMap((name) => [`${name}_start`, `${name}_reply`]));
    return async (input, output) => {
        if (!delegateToolNames.has(input.tool))
            return;
        // Model gate on the direct tool path (design D3): same allow-list as the
        // slash-command path, so calling {name}_start/{name}_reply directly
        // cannot bypass it. Unknown model fails open — this is a guardrail
        // against known-bad models, not a sandbox.
        const patterns = config.verifiedModels;
        if (patterns && patterns.length > 0) {
            const model = getSessionModel(input.sessionID);
            if (model && !matchesVerifiedModel(model, patterns)) {
                throw new Error(`[plugin] The current model (${model.providerID}/${model.modelID}) is not on the verified-models allow-list for CLI delegation, so ${input.tool} was blocked. Switch to a verified model and try again.`);
            }
        }
        const prompt = output.args?.prompt;
        if (typeof prompt === "string" && prompt.includes(GENERATED_MARKER)) {
            throw new Error(`${input.tool} rejected: the "prompt" argument contains the whole delegate command template instead of the user's actual message. Pass only the user's text as "prompt".`);
        }
    };
}
//# sourceMappingURL=hooks.js.map