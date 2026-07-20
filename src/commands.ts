import { writeFileSync, mkdirSync, existsSync } from "fs"
import { join } from "path"
import type { CliDispatchConfig } from "./config"

const DELEGATE_COMMAND_TEMPLATE = `---
description: Delegate this conversation to the {{NAME}} CLI (sticky - follow-ups keep going to {{NAME}} until another /codex or /cc command is used)
---

Delegate this conversation to the {{NAME}} CLI.

**Right now:** if no {{NAME}} session is active yet for this conversation, call the \`{{NAME}}_start\` tool with the user's message (the text after /{{NAME}}, or the whole message if /{{NAME}} was sent alone) as the \`prompt\` argument. If a {{NAME}} session is already active, call \`{{NAME}}_reply\` instead. Return the tool's response to the user as your answer — do not add your own commentary on top of it unless the user asks a question about it separately.

**For every message after this one** — until the user runs another delegate command — do not answer directly and do not reason about the request yourself. Instead call \`{{NAME}}_reply\` with the user's new message as the \`prompt\` argument, and return its response. This applies even when the message has no command prefix.

If \`{{NAME}}_reply\` fails because no {{NAME}} session is active (e.g. it was never started, or opencode restarted since), call \`{{NAME}}_start\` instead and continue from there.

**Exiting delegation:** run \`/opencode\` to end the delegation for this session (cleared deterministically by the plugin; afterwards opencode answers directly again). While a delegation is active, ALL user input is forwarded to {{NAME}} as prompt content — including non-delegate commands and agent mentions (e.g. \`@explore\`). If {{NAME}} fails, the error message will remind you about \`/opencode\`; the delegation stays active so you can fix the problem and continue, or exit.
`

const OPENCODE_COMMAND_TEMPLATE = `---
description: Exit CLI delegation and return to opencode (sticky off)
---

The plugin has already cleared any active CLI delegation for this session — look for a \`[plugin]\` note in this message stating what happened. Reply in one or two sentences, relaying that note: if a delegation was cleared, say which delegate was exited and that opencode is handling the conversation directly again; if no delegation was active, say so. Do not call any delegate tool in response to this command.
`

function generateDelegateCommand(name: string): string {
  return DELEGATE_COMMAND_TEMPLATE.replaceAll("{{NAME}}", name)
}

export function generateCommands(config: CliDispatchConfig, outputDir: string): void {
  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true })
  }

  // Generate delegate commands
  for (const name of Object.keys(config.delegates)) {
    const content = generateDelegateCommand(name)
    writeFileSync(join(outputDir, `${name}.md`), content, "utf-8")
  }

  // Generate /opencode command (always needed)
  writeFileSync(join(outputDir, "opencode.md"), OPENCODE_COMMAND_TEMPLATE, "utf-8")
}
