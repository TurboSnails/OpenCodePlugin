#!/usr/bin/env bun
import { readFileSync } from "fs";
import { handleUserPromptSubmit } from "./hooks/user-prompt-submit";
import { handlePreToolUse } from "./hooks/pre-tool-use";
import { handleSessionEnd } from "./hooks/session-end";
const raw = readFileSync(0, "utf-8");
const input = JSON.parse(raw);
const event = input.hook_event_name;
let output = {};
if (event === "UserPromptSubmit") {
    output = handleUserPromptSubmit(input);
}
else if (event === "PreToolUse") {
    output = handlePreToolUse(input) ?? {};
}
else if (event === "SessionEnd") {
    handleSessionEnd(input);
}
process.stdout.write(JSON.stringify(output) + "\n");
//# sourceMappingURL=hooks.js.map