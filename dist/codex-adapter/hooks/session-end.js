import { codexFileDelegateStore } from "../session-store";
export function handleSessionEnd(input, stateDir) {
    if (!input.session_id)
        return;
    codexFileDelegateStore(stateDir).clearActiveDelegate(input.session_id);
}
//# sourceMappingURL=session-end.js.map