import { startDelegateTurn, replyDelegateTurn } from "../delegate-turn";
import { codexFileDelegateStore, readCurrentSession } from "./session-store";
const HOME_COMMAND = "/prompts:opencode";
function currentSessionKey(stateDir) {
    const id = readCurrentSession(stateDir);
    if (!id) {
        throw new Error("No active Codex session is known; send any prompt first so the UserPromptSubmit hook records the session id.");
    }
    return id;
}
export async function startDelegate(name, cfg, prompt, options = {}) {
    return startDelegateTurn({
        name,
        cfg,
        store: codexFileDelegateStore(options.stateDir),
        sessionKey: currentSessionKey(options.stateDir),
        prompt,
        homeCommand: HOME_COMMAND,
        onProgress: options.onProgress ?? (() => { }),
        ...(options.cwd ? { cwd: options.cwd } : {}),
        ...(options.run ? { run: options.run } : {}),
    });
}
export async function replyDelegate(name, cfg, prompt, options = {}) {
    return replyDelegateTurn({
        name,
        cfg,
        store: codexFileDelegateStore(options.stateDir),
        sessionKey: currentSessionKey(options.stateDir),
        prompt,
        homeCommand: HOME_COMMAND,
        onProgress: options.onProgress ?? (() => { }),
        ...(options.cwd ? { cwd: options.cwd } : {}),
        ...(options.run ? { run: options.run } : {}),
    });
}
//# sourceMappingURL=delegate-tools.js.map