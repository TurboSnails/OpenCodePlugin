import { tool } from "@opencode-ai/plugin";
import { resolveArgs } from "./config";
import { runDelegate } from "./run-delegate";
import { getActiveDelegate, setActiveDelegate, getSessionAgent, beginDelegateStart, isLatestDelegateStart } from "./session-store";
import { snapshotWorktree, buildChangeSummary } from "./worktree-summary";
export { snapshotWorktree, buildChangeSummary } from "./worktree-summary";
// Default per-run timeout for a delegate CLI invocation; a delegate config
// may override it with its own timeoutMs.
const DEFAULT_DELEGATE_TIMEOUT_MS = 10 * 60 * 1000;
// opencode agents confirmed (via live spike, see delegate-permission-passthrough/design.md)
// to inject a system prompt that tells the model file edits/tool calls are forbidden.
// opencode itself never blocks the call (no `permission.ask` event fires), so the
// model can silently refuse or misbehave instead of erroring — surface it explicitly.
const RESTRICTIVE_AGENTS = new Set(["plan"]);
export function makeStartTool(name, cfg, run = runDelegate) {
    return tool({
        description: `Start a new ${name} CLI session with the given task and return ${name}'s response. Use this the first time a conversation is delegated to ${name}.`,
        args: { prompt: tool.schema.string() },
        async execute(args, context) {
            const agent = getSessionAgent(context.sessionID);
            if (agent && RESTRICTIVE_AGENTS.has(agent)) {
                return `The "${agent}" agent restricts delegate tool calls via its system prompt, so ${name}_start may be blocked or misbehave. Use /opencode to exit any active delegation, or switch to a less restrictive agent, before continuing.`;
            }
            const sessionId = crypto.randomUUID();
            const startSequence = beginDelegateStart(context.sessionID);
            const resolvedArgs = resolveArgs(cfg.startArgs, {
                prompt: args.prompt,
                sessionId,
            });
            const workDir = context.directory ?? process.cwd();
            const before = snapshotWorktree(workDir);
            let result;
            try {
                result = await run({
                    binary: cfg.binary,
                    args: resolvedArgs,
                    parser: cfg.parser,
                    onProgress: (text) => context.metadata({ title: name, metadata: { progress: text } }),
                    timeoutMs: cfg.timeoutMs ?? DEFAULT_DELEGATE_TIMEOUT_MS,
                    signal: context.abort,
                    cwd: workDir,
                });
            }
            catch (err) {
                return `${name} failed: ${err instanceof Error ? err.message : String(err)}. Use /opencode to exit delegation.`;
            }
            const externalId = result.externalId ?? sessionId;
            // Only the latest initiated start may register its delegation; an
            // earlier start that finishes later must not overwrite it.
            if (externalId && isLatestDelegateStart(context.sessionID, startSequence)) {
                setActiveDelegate(context.sessionID, name, externalId);
            }
            const summary = before === null ? null : buildChangeSummary(before, snapshotWorktree(workDir) ?? before, workDir);
            return (result.finalText || `(${name} returned no text response)`) + (summary ?? "");
        },
    });
}
export function makeReplyTool(name, cfg, run = runDelegate) {
    return tool({
        description: `Continue the active ${name} CLI session for this conversation with a follow-up message. Requires ${name}_start to have been called first.`,
        args: { prompt: tool.schema.string() },
        async execute(args, context) {
            const active = getActiveDelegate(context.sessionID);
            if (!active || active.delegate !== name) {
                throw new Error(`No active ${name} session for this conversation. Call ${name}_start first.`);
            }
            const agent = getSessionAgent(context.sessionID);
            if (agent && RESTRICTIVE_AGENTS.has(agent)) {
                return `The "${agent}" agent restricts delegate follow-ups via its system prompt, so ${name}_reply may be blocked or misbehave. Use /opencode to exit this delegation, or switch to a less restrictive agent, before continuing.`;
            }
            const resolvedArgs = resolveArgs(cfg.replyArgs, {
                prompt: args.prompt,
                externalId: active.externalId,
            });
            const workDir = context.directory ?? process.cwd();
            const before = snapshotWorktree(workDir);
            let result;
            try {
                result = await run({
                    binary: cfg.binary,
                    args: resolvedArgs,
                    parser: cfg.parser,
                    onProgress: (text) => context.metadata({ title: name, metadata: { progress: text } }),
                    timeoutMs: cfg.timeoutMs ?? DEFAULT_DELEGATE_TIMEOUT_MS,
                    signal: context.abort,
                    cwd: workDir,
                });
            }
            catch (err) {
                return `${name} failed: ${err instanceof Error ? err.message : String(err)}. Use /opencode to exit delegation.`;
            }
            const summary = before === null ? null : buildChangeSummary(before, snapshotWorktree(workDir) ?? before, workDir);
            return (result.finalText || `(${name} returned no text response)`) + (summary ?? "");
        },
    });
}
//# sourceMappingURL=delegate-tools.js.map