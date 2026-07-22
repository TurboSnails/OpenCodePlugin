import { writeFileSync, mkdirSync, existsSync, readdirSync, readFileSync, rmSync } from "fs";
import { join } from "path";
import { GENERATED_MARKER } from "./policy";
// Canonical home is src/policy.ts; re-exported for backwards compatibility.
export { GENERATED_MARKER };
const DELEGATE_COMMAND_TEMPLATE = `---
description: Delegate this conversation to the {{NAME}} CLI (sticky - follow-ups keep going to {{NAME}} {{UNTIL}})
delegate: {{NAME}}
---

${GENERATED_MARKER}

Delegate this conversation to the {{NAME}} CLI.

**Right now:** if no {{NAME}} session is active yet for this conversation, call the \`{{NAME}}_start\` tool with the user's message (the text after /{{NAME}}, or the whole message if /{{NAME}} was sent alone) as the \`prompt\` argument. If a {{NAME}} session is already active, call \`{{NAME}}_reply\` instead. Return the tool's response to the user as your answer — do not add your own commentary on top of it unless the user asks a question about it separately.

**For every message after this one** — until the user runs another delegate command — do not answer directly and do not reason about the request yourself. Instead call \`{{NAME}}_reply\` with the user's new message as the \`prompt\` argument, and return its response. This applies even when the message has no command prefix.

If \`{{NAME}}_reply\` fails because no {{NAME}} session is active (e.g. it was never started, or opencode restarted since), call \`{{NAME}}_start\` instead and continue from there.

**Exiting delegation:** run \`/opencode\` to end the delegation for this session (cleared deterministically by the plugin; afterwards opencode answers directly again). While a delegation is active, ALL user input is forwarded to {{NAME}} as prompt content — including non-delegate commands and agent mentions (e.g. \`@explore\`). If {{NAME}} fails, the error message will remind you about \`/opencode\`; the delegation stays active so you can fix the problem and continue, or exit.
`;
const OPENCODE_COMMAND_TEMPLATE = `---
description: Exit CLI delegation and return to opencode (sticky off)
---

${GENERATED_MARKER}

The plugin has already cleared any active CLI delegation for this session — look for a \`[plugin]\` note in this message stating what happened. Reply in one or two sentences, relaying that note: if a delegation was cleared, say which delegate was exited and that opencode is handling the conversation directly again; if no delegation was active, say so. Do not call any delegate tool in response to this command.
`;
function generateDelegateCommand(name, otherNames) {
    const until = otherNames.length > 0
        ? `until another delegate command (${otherNames.map((n) => `/${n}`).join(", ")}) is used`
        : "until delegation is exited with /opencode";
    return DELEGATE_COMMAND_TEMPLATE.replaceAll("{{NAME}}", name).replaceAll("{{UNTIL}}", until);
}
function writeIfChanged(path, content) {
    if (existsSync(path) && readFileSync(path, "utf-8") === content)
        return;
    writeFileSync(path, content, "utf-8");
}
function generateCcAlias(name, otherNames) {
    return generateDelegateCommand(name, otherNames).replace(/^description: .*$/m, `description: Alias for /${name} — delegate this conversation to the ${name} CLI (sticky)`);
}
export function generateCommands(config, outputDir) {
    if (!existsSync(outputDir)) {
        mkdirSync(outputDir, { recursive: true });
    }
    const names = Object.keys(config.delegates);
    // Generate delegate commands
    for (const name of names) {
        const content = generateDelegateCommand(name, names.filter((n) => n !== name));
        writeIfChanged(join(outputDir, `${name}.md`), content);
    }
    // Generate /opencode command (always needed)
    writeIfChanged(join(outputDir, "opencode.md"), OPENCODE_COMMAND_TEMPLATE);
    // Generate /cc alias for claude; never clobber a hand-maintained file
    const ccPath = join(outputDir, "cc.md");
    if (names.includes("claude")) {
        const alias = generateCcAlias("claude", names.filter((n) => n !== "claude"));
        if (!existsSync(ccPath) || readFileSync(ccPath, "utf-8").includes(GENERATED_MARKER)) {
            writeIfChanged(ccPath, alias);
        }
    }
    // Remove command files we generated for delegates that are no longer
    // configured. Only files carrying the generated marker are eligible;
    // hand-maintained files (no marker) are never touched.
    const current = new Set([...names.map((n) => `${n}.md`), "opencode.md"]);
    if (names.includes("claude"))
        current.add("cc.md");
    for (const file of readdirSync(outputDir)) {
        if (!file.endsWith(".md") || current.has(file))
            continue;
        const path = join(outputDir, file);
        if (readFileSync(path, "utf-8").includes(GENERATED_MARKER)) {
            rmSync(path);
        }
    }
}
//# sourceMappingURL=commands.js.map