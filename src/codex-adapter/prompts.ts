import { writeFileSync, mkdirSync, existsSync, readdirSync, readFileSync, rmSync } from "fs"
import { join } from "path"
import { homedir } from "os"
import type { CodexAdapterConfig } from "./config"
import { GENERATED_MARKER } from "../policy"

const DELEGATE_PROMPT_TEMPLATE = `---
description: Delegate the current turn to the {{NAME}} CLI
argument-hint: task for {{NAME}}
---

${GENERATED_MARKER}

You are delegating to the {{NAME}} CLI. Call the MCP tool \`{{NAME}}_start\` with the user's request as the \`prompt\` argument. Do not answer directly.
`

const EXIT_PROMPT_TEMPLATE = `---
description: Exit CLI delegation and return to Codex
---

${GENERATED_MARKER}

The user wants to exit the active CLI delegation. Do not call any delegate tool; Codex should answer directly from now on.
`

function writeIfChanged(path: string, content: string): void {
  if (existsSync(path) && readFileSync(path, "utf-8") === content) return
  writeFileSync(path, content, "utf-8")
}

export function generateCodexPrompts(
  config: CodexAdapterConfig,
  outputDir: string = join(homedir(), ".codex", "prompts"),
): void {
  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true })
  }

  const names = Object.keys(config.delegates)

  for (const name of names) {
    const content = DELEGATE_PROMPT_TEMPLATE.replaceAll("{{NAME}}", name)
    writeIfChanged(join(outputDir, `${name}.md`), content)
  }

  writeIfChanged(join(outputDir, "opencode.md"), EXIT_PROMPT_TEMPLATE)

  // Remove stale generated prompts; never touch hand-written files.
  const current = new Set([...names.map((n) => `${n}.md`), "opencode.md"])
  for (const file of readdirSync(outputDir)) {
    if (!file.endsWith(".md") || current.has(file)) continue
    const path = join(outputDir, file)
    if (readFileSync(path, "utf-8").includes(GENERATED_MARKER)) {
      rmSync(path)
    }
  }
}
