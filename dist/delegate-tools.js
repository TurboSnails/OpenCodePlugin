import { tool } from "@opencode-ai/plugin";
import { startDelegateTurn, replyDelegateTurn } from "./delegate-turn";
import { getSessionAgent, memoryDelegateStore, takeSessionNotice } from "./session-store";
export { snapshotWorktree, buildChangeSummary } from "./worktree-summary";
// opencode agents confirmed (via live spike, see delegate-permission-passthrough/design.md)
// to inject a system prompt that tells the model file edits/tool calls are forbidden.
// opencode itself never blocks the call (no `permission.ask` event fires), so the
// model can silently refuse or misbehave instead of erroring — surface it explicitly.
const RESTRICTIVE_AGENTS = new Set(["plan"]);
const HOME_COMMAND = "/opencode";
export function makeStartTool(name, cfg, run) {
    return tool({
        description: `Start a new ${name} CLI session with the given task and return ${name}'s response. Use this the first time a conversation is delegated to ${name}.`,
        args: { prompt: tool.schema.string() },
        async execute(args, context) {
            const agent = getSessionAgent(context.sessionID);
            if (agent && RESTRICTIVE_AGENTS.has(agent)) {
                return `The "${agent}" agent restricts delegate tool calls via its system prompt, so ${name}_start may be blocked or misbehave. Use /opencode to exit any active delegation, or switch to a less restrictive agent, before continuing.`;
            }
            const text = await startDelegateTurn({
                name,
                cfg,
                store: memoryDelegateStore,
                sessionKey: context.sessionID,
                prompt: args.prompt,
                homeCommand: HOME_COMMAND,
                onProgress: (text) => context.metadata({ title: name, metadata: { progress: text } }),
                signal: context.abort,
                cwd: context.directory ?? process.cwd(),
                ...(run ? { run } : {}),
            });
            const notice = takeSessionNotice(context.sessionID);
            return notice?.kind === "restored"
                ? `[plugin] Restored the active ${notice.delegate} delegation from saved state after a restart.\n\n${text}`
                : text;
        },
    });
}
export function makeReplyTool(name, cfg, run) {
    return tool({
        description: `Continue the active ${name} CLI session for this conversation with a follow-up message. Requires ${name}_start to have been called first.`,
        args: { prompt: tool.schema.string() },
        async execute(args, context) {
            const active = memoryDelegateStore.getActiveDelegate(context.sessionID);
            if (!active || active.delegate !== name) {
                const notice = takeSessionNotice(context.sessionID);
                if (notice?.kind === "lost") {
                    throw new Error(`The saved delegation state for this session expired or was lost (e.g. after an opencode restart). Run /opencode to exit, then start again with /${name}.`);
                }
                throw new Error(`No active ${name} session for this conversation. Call ${name}_start first.`);
            }
            const agent = getSessionAgent(context.sessionID);
            if (agent && RESTRICTIVE_AGENTS.has(agent)) {
                return `The "${agent}" agent restricts delegate follow-ups via its system prompt, so ${name}_reply may be blocked or misbehave. Use /opencode to exit this delegation, or switch to a less restrictive agent, before continuing.`;
            }
            const text = await replyDelegateTurn({
                name,
                cfg,
                store: memoryDelegateStore,
                sessionKey: context.sessionID,
                prompt: args.prompt,
                homeCommand: HOME_COMMAND,
                onProgress: (text) => context.metadata({ title: name, metadata: { progress: text } }),
                signal: context.abort,
                cwd: context.directory ?? process.cwd(),
                ...(run ? { run } : {}),
            });
            const notice = takeSessionNotice(context.sessionID);
            return notice?.kind === "restored"
                ? `[plugin] Restored the active ${notice.delegate} delegation from saved state after a restart.\n\n${text}`
                : text;
        },
    });
}
//# sourceMappingURL=delegate-tools.js.map