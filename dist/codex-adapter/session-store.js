import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { fileDelegateStore } from "../claude-code-adapter/session-store";
// Codex hooks and the MCP server run as separate processes, so delegation
// state lives in files under ~/.codex/cli-dispatch/ (design.md D-store).
// Writes are atomic (write-temp-then-rename).
export function defaultCodexStateDir() {
    return join(homedir(), ".codex", "cli-dispatch");
}
export function codexFileDelegateStore(dir = defaultCodexStateDir()) {
    return fileDelegateStore(dir);
}
const CURRENT_SESSION_FILE = "current-session";
const SESSION_ID_RE = /^[\w-]+$/;
function ensureDir(dir) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    try {
        chmodSync(dir, 0o700);
    }
    catch { }
}
export function writeCurrentSession(sessionId, dir = defaultCodexStateDir()) {
    ensureDir(dir);
    const file = join(dir, CURRENT_SESSION_FILE);
    const tmp = `${file}.${process.pid}.tmp`;
    writeFileSync(tmp, sessionId, { encoding: "utf-8", mode: 0o600 });
    renameSync(tmp, file);
}
export function readCurrentSession(dir = defaultCodexStateDir()) {
    try {
        const id = readFileSync(join(dir, CURRENT_SESSION_FILE), "utf-8").trim();
        return SESSION_ID_RE.test(id) ? id : undefined;
    }
    catch {
        return undefined;
    }
}
//# sourceMappingURL=session-store.js.map