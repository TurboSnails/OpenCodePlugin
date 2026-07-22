import { buildRoutingRule } from "../routing-rule";
import { matchesModelPattern } from "./config";
import { getCurrentModel } from "./current-model";
import { getActiveDelegate, clearActiveDelegate } from "./session-store";
import { mcpToolName } from "./pretooluse-check";
// The "come home" command (design.md D6) — same convention as OpenCode's
// /opencode and this repo's .opencode/command/cc.md alias.
export const HOME_COMMAND = "/cc";
// A custom slash command's payload carries the raw, unexpanded text
// (design.md D4), so command detection is plain prefix matching.
function detectDelegateCommand(prompt, delegateNames) {
    return delegateNames.find((name) => prompt === `/${name}` || prompt.startsWith(`/${name} `));
}
export function decideUserPromptSubmit(input, config, stateDir) {
    const prompt = (input.prompt ?? "").trimStart();
    // Home command: clear state and block. Exit 2 suppresses the prompt with
    // zero model involvement (design.md D4) — the reason reaches the user as-is.
    if (prompt === HOME_COMMAND || prompt.startsWith(`${HOME_COMMAND} `)) {
        const active = getActiveDelegate(input.session_id, stateDir);
        clearActiveDelegate(input.session_id, stateDir);
        return {
            kind: "block",
            reason: active
                ? `[cli-dispatch] Cleared the active ${active.delegate} delegation for this session. Claude Code answers directly again.`
                : "[cli-dispatch] No CLI delegation was active for this session.",
        };
    }
    // Delegate-start command: apply the verifiedModels gate before any tool is
    // offered to the model. Fail open when the model is unknown (design.md D7).
    const target = detectDelegateCommand(prompt, Object.keys(config.delegates));
    if (target) {
        const patterns = config.verifiedModels;
        if (!patterns || patterns.length === 0)
            return { kind: "none" };
        const model = input.transcript_path ? getCurrentModel(input.transcript_path) : undefined;
        if (!model)
            return { kind: "none" };
        if (matchesModelPattern(model, patterns))
            return { kind: "none" };
        return {
            kind: "block",
            reason: `[cli-dispatch] The current model (${model}) is not on the verified-models allow-list for CLI delegation, so ${target} was not started. Switch to a verified model and try again.`,
        };
    }
    // Sticky routing: an active delegation with no recognized command prefix
    // forwards everything to the delegate's reply tool.
    const active = getActiveDelegate(input.session_id, stateDir);
    if (!active)
        return { kind: "none" };
    return { kind: "inject", context: buildRoutingRule(active.delegate, mcpToolName(active.delegate, "reply")) };
}
//# sourceMappingURL=userpromptsubmit-logic.js.map