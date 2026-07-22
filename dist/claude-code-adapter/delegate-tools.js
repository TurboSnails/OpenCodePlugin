import { startDelegateTurn, replyDelegateTurn } from "../delegate-turn";
import { fileDelegateStore } from "./session-store";
const HOME_COMMAND = "/cc";
export async function startDelegate(name, cfg, claudeSessionId, prompt, options = {}) {
    return startDelegateTurn({
        name,
        cfg,
        store: fileDelegateStore(options.stateDir),
        sessionKey: claudeSessionId,
        prompt,
        homeCommand: HOME_COMMAND,
        onProgress: options.onProgress ?? (() => { }),
        ...(options.cwd ? { cwd: options.cwd } : {}),
        ...(options.run ? { run: options.run } : {}),
    });
}
export async function replyDelegate(name, cfg, claudeSessionId, prompt, options = {}) {
    return replyDelegateTurn({
        name,
        cfg,
        store: fileDelegateStore(options.stateDir),
        sessionKey: claudeSessionId,
        prompt,
        homeCommand: HOME_COMMAND,
        onProgress: options.onProgress ?? (() => { }),
        ...(options.cwd ? { cwd: options.cwd } : {}),
        ...(options.run ? { run: options.run } : {}),
    });
}
//# sourceMappingURL=delegate-tools.js.map