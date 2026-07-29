import { getActiveDelegate, clearActiveDelegate, setSessionAgent, setSessionModel, getSessionModel } from "./session-store";
import { buildRoutingRule } from "./routing-rule";
import { checkDelegationGate } from "./policy";
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
        const delegate = detectTargetedDelegate(output.parts, Object.keys(config.delegates));
        if (!delegate)
            return;
        const model = getSessionModel(input.sessionID);
        const decision = checkDelegationGate({
            target: { kind: "command", delegate },
            model,
            verifiedModels: patterns,
            prefix: "[plugin]",
        });
        if (decision.allow)
            return;
        output.parts.length = 0;
        output.parts.push({ type: "text", text: decision.reason, synthetic: true });
    };
}
// Host-agnostic session.idle detection (design D1-D3, verified against a
// real opencode instance on 2026-07-24 — see design.md). Finds the messages
// produced by the latest turn (everything after the last "user" message) and
// reports a violation when none of them called a configured delegate tool
// and none of them was a user-initiated abort.
export function findRoutingViolation(messages, compliantTools) {
    let lastUserIndex = -1;
    for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i].info.role === "user") {
            lastUserIndex = i;
            break;
        }
    }
    if (lastUserIndex < 0)
        return false;
    const turnMessages = messages.slice(lastUserIndex + 1);
    if (turnMessages.length === 0)
        return false;
    // A user-initiated abort is not the model refusing to delegate (design D1).
    if (turnMessages.some((m) => m.info.error?.name === "MessageAbortedError"))
        return false;
    const compliant = turnMessages.some((m) => m.parts.some((p) => p.type === "tool" && p.tool !== undefined && compliantTools.has(p.tool)));
    return !compliant;
}
// Detects a sticky-routing violation once a turn ends and disconnects the
// delegation instead of leaving it silently active (design D1, option C):
// this cannot force the model to comply, only stop misleading the user once
// non-compliance is observed.
export function makeSessionIdle(config, client) {
    const compliantTools = new Set(Object.keys(config.delegates).flatMap((name) => [`${name}_start`, `${name}_reply`]));
    return async (input) => {
        if (input.event.type !== "session.idle")
            return;
        const sessionID = input.event.properties?.sessionID;
        if (typeof sessionID !== "string")
            return;
        const active = getActiveDelegate(sessionID);
        if (!active)
            return;
        const res = await client.session.messages({ path: { id: sessionID } });
        if (!findRoutingViolation(res.data ?? [], compliantTools))
            return;
        clearActiveDelegate(sessionID);
        await client.session.prompt({
            path: { id: sessionID },
            body: {
                noReply: true,
                parts: [
                    {
                        type: "text",
                        synthetic: true,
                        text: `[plugin] Sticky delegation to ${active.delegate} was disconnected: the model answered directly instead of calling ${active.delegate}_reply. Run /${active.delegate} <message> to resume.`,
                    },
                ],
            },
        });
    };
}
export function makeToolExecuteBefore(config) {
    const delegateToolNames = new Set(Object.keys(config.delegates).flatMap((name) => [`${name}_start`, `${name}_reply`]));
    return async (input, output) => {
        if (!delegateToolNames.has(input.tool))
            return;
        const decision = checkDelegationGate({
            target: { kind: "tool", delegate: input.tool.replace(/_(start|reply)$/, ""), tool: input.tool },
            prompt: output.args?.prompt,
            model: getSessionModel(input.sessionID),
            verifiedModels: config.verifiedModels,
            prefix: "[plugin]",
        });
        if (!decision.allow)
            throw new Error(decision.reason);
    };
}
//# sourceMappingURL=hooks.js.map