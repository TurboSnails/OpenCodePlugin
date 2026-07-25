import { resolveArgs } from "./config";
import { runDelegate } from "./run-delegate";
import { snapshotWorktree, buildChangeSummary } from "./worktree-summary";
import { isValidExternalId } from "./policy";
// Default per-run timeout for a delegate CLI invocation; a delegate config
// may override it with its own timeoutMs.
export const DEFAULT_DELEGATE_TIMEOUT_MS = 10 * 60 * 1000;
async function runTurn(options, resolvedArgs, workDir) {
    const run = options.run ?? runDelegate;
    return run({
        binary: options.cfg.binary,
        args: resolvedArgs,
        parser: options.cfg.parser,
        onProgress: options.onProgress,
        timeoutMs: options.cfg.timeoutMs ?? DEFAULT_DELEGATE_TIMEOUT_MS,
        ...(options.signal ? { signal: options.signal } : {}),
        cwd: workDir,
    });
}
function failureMessage(name, homeCommand, err) {
    return `${name} failed: ${err instanceof Error ? err.message : String(err)}. Use ${homeCommand} to exit delegation.`;
}
export async function startDelegateTurn(options) {
    const { name, cfg, store, sessionKey, prompt } = options;
    const sessionId = crypto.randomUUID();
    const startSequence = store.beginDelegateStart(sessionKey);
    const resolvedArgs = resolveArgs(cfg.startArgs, { prompt, sessionId });
    const workDir = options.cwd ?? process.cwd();
    const before = snapshotWorktree(workDir);
    let result;
    try {
        result = await runTurn(options, resolvedArgs, workDir);
    }
    catch (err) {
        return failureMessage(name, options.homeCommand, err);
    }
    // Ignore a parser-reported id outside the conservative pattern (design
    // D4) and fall back to the client-generated session id.
    const externalId = result.externalId && isValidExternalId(result.externalId) ? result.externalId : sessionId;
    if (result.externalId && externalId === sessionId) {
        console.warn(`[cli-dispatch] ${name} reported a session id that failed validation; falling back to a client-generated id. ` +
            `The delegate session may not resume correctly on the next reply.`);
    }
    store.setActiveDelegateIfLatest(sessionKey, name, externalId, startSequence);
    const summary = before === null ? null : buildChangeSummary(before, snapshotWorktree(workDir) ?? before, workDir);
    return (result.finalText || `(${name} returned no text response)`) + (summary ?? "");
}
export async function replyDelegateTurn(options) {
    const { name, cfg, store, sessionKey, prompt } = options;
    const active = store.getActiveDelegate(sessionKey);
    if (!active || active.delegate !== name) {
        throw new Error(`No active ${name} session for this conversation. Call ${name}_start first.`);
    }
    const resolvedArgs = resolveArgs(cfg.replyArgs, { prompt, externalId: active.externalId });
    const workDir = options.cwd ?? process.cwd();
    const before = snapshotWorktree(workDir);
    let result;
    try {
        result = await runTurn(options, resolvedArgs, workDir);
    }
    catch (err) {
        return failureMessage(name, options.homeCommand, err);
    }
    const summary = before === null ? null : buildChangeSummary(before, snapshotWorktree(workDir) ?? before, workDir);
    return (result.finalText || `(${name} returned no text response)`) + (summary ?? "");
}
//# sourceMappingURL=delegate-turn.js.map