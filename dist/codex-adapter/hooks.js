#!/usr/bin/env bun
import { readFileSync } from "fs";
import { handleUserPromptSubmit } from "./hooks/user-prompt-submit";
import { handlePreToolUse } from "./hooks/pre-tool-use";
import { handleSessionEnd } from "./hooks/session-end";
export function runHookEntry(raw) {
    let output = {};
    try {
        const input = JSON.parse(raw);
        const event = input.hook_event_name;
        if (event === "UserPromptSubmit") {
            output = handleUserPromptSubmit(input);
        }
        else if (event === "PreToolUse") {
            output = handlePreToolUse(input) ?? {};
        }
        else if (event === "SessionEnd") {
            handleSessionEnd(input);
        }
    }
    catch {
        output = {};
    }
    return JSON.stringify(output);
}
if (import.meta.main) {
    let raw = "";
    try {
        raw = readFileSync(0, "utf-8");
    }
    catch {
        raw = "";
    }
    process.stdout.write(runHookEntry(raw) + "\n");
}
//# sourceMappingURL=hooks.js.map