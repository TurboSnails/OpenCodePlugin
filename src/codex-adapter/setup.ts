import { readFileSync, writeFileSync, existsSync, mkdirSync, chmodSync, readdirSync, rmSync } from "fs"
import { dirname, join } from "path"
import { homedir } from "os"
import { fileURLToPath } from "url"
import { loadCodexAdapterConfig } from "./config"
import { generateCodexPrompts } from "./prompts"
import { MCP_SERVER_NAME } from "./constants"
import { defaultCodexStateDir } from "./session-store"
import { GENERATED_MARKER } from "../policy"

const moduleDir = dirname(fileURLToPath(import.meta.url))

export type SetupOptions = {
  dryRun?: boolean
  homeDir?: string
  configPath?: string
  mcpServerCommand?: string[]
  hooksCommand?: string[]
}

function defaultMcpServerCommand(): string[] {
  return ["bun", "run", join(moduleDir, "mcp-server.js")]
}

function defaultHooksCommand(): string[] {
  return ["bun", "run", join(moduleDir, "hooks.js")]
}

function ensureDir(dir: string): void {
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  try {
    chmodSync(dir, 0o700)
  } catch {}
}

const MCP_SECTION_HEADER = `[mcp_servers.${MCP_SERVER_NAME}]`

function upsertMcpSection(toml: string, section: string): string {
  const lines = toml.split("\n")
  const start = lines.findIndex((l) => l.trim() === MCP_SECTION_HEADER)
  if (start === -1) {
    return (toml.trimEnd() ? toml.trimEnd() + "\n\n" : "") + section + "\n"
  }
  let end = start + 1
  while (end < lines.length && !lines[end].startsWith("[")) end++
  const before = lines.slice(0, start).join("\n")
  const after = lines.slice(end).join("\n")
  return (before.trimEnd() ? before.trimEnd() + "\n\n" : "") + section + (after.trim() ? "\n\n" + after.trimStart() : "\n")
}

function removeMcpSection(toml: string): string {
  const lines = toml.split("\n")
  const start = lines.findIndex((l) => l.trim() === MCP_SECTION_HEADER)
  if (start === -1) return toml
  let end = start + 1
  while (end < lines.length && !lines[end].startsWith("[")) end++
  const before = lines.slice(0, start).join("\n")
  const after = lines.slice(end).join("\n")
  return (before.trimEnd() + "\n\n" + after.trimStart()).trim() + "\n"
}

function upsertHook(hooksJson: { hooks?: Record<string, Array<Record<string, unknown>>> }, event: string, command: string, matcher?: string): boolean {
  hooksJson.hooks ??= {}
  const groups = (hooksJson.hooks[event] ??= [])
  const exists = groups.some((g) =>
    Array.isArray((g as { hooks?: Array<{ command?: string }> }).hooks) &&
    (g as { hooks?: Array<{ command?: string }> }).hooks!.some((h) => h.command === command),
  )
  if (exists) return false
  const group: Record<string, unknown> = {
    hooks: [{ type: "command", command, timeout: 30 }],
  }
  if (matcher) group.matcher = matcher
  groups.push(group)
  return true
}

function removeHook(hooksJson: { hooks?: Record<string, Array<Record<string, unknown>>> }, event: string, command: string): boolean {
  const groups = hooksJson.hooks?.[event]
  if (!groups) return false
  const before = groups.length
  hooksJson.hooks![event] = groups.filter(
    (g) =>
      !(
        Array.isArray((g as { hooks?: Array<{ command?: string }> }).hooks) &&
        (g as { hooks?: Array<{ command?: string }> }).hooks!.some((h) => h.command === command)
      ),
  )
  if (hooksJson.hooks![event].length === 0) delete hooksJson.hooks![event]
  return hooksJson.hooks![event]?.length !== before
}

export function setupCodexAdapter(options: SetupOptions = {}): string[] {
  const changes: string[] = []
  const home = options.homeDir ?? homedir()
  const config = loadCodexAdapterConfig(options.configPath)

  const stateDir = defaultCodexStateDir()
  if (!options.dryRun) ensureDir(stateDir)
  changes.push(`ensured ${stateDir} (0700)`)

  const promptsDir = join(home, ".codex", "prompts")
  if (!options.dryRun) generateCodexPrompts(config, promptsDir)
  changes.push(`generated prompts in ${promptsDir}`)

  const configTomlPath = join(home, ".codex", "config.toml")
  const mcpCommand = options.mcpServerCommand ?? defaultMcpServerCommand()
  const mcpSection = `${MCP_SECTION_HEADER}\ncommand = ${JSON.stringify(mcpCommand[0])}\nargs = ${JSON.stringify(mcpCommand.slice(1))}\n`
  let toml = existsSync(configTomlPath) ? readFileSync(configTomlPath, "utf-8") : ""
  toml = upsertMcpSection(toml, mcpSection.trimEnd())
  if (!options.dryRun) writeFileSync(configTomlPath, toml, "utf-8")
  changes.push(`registered MCP server ${MCP_SERVER_NAME} in ${configTomlPath}`)

  const hooksPath = join(home, ".codex", "hooks.json")
  const hooksCommand = (options.hooksCommand ?? defaultHooksCommand()).join(" ")
  const hooksJson = existsSync(hooksPath)
    ? (JSON.parse(readFileSync(hooksPath, "utf-8")) as { hooks?: Record<string, Array<Record<string, unknown>>> })
    : {}
  const changed =
    upsertHook(hooksJson, "UserPromptSubmit", hooksCommand) ||
    upsertHook(hooksJson, "PreToolUse", hooksCommand, `mcp__${MCP_SERVER_NAME}__.*`) ||
    upsertHook(hooksJson, "SessionEnd", hooksCommand)
  if (!options.dryRun && changed) writeFileSync(hooksPath, JSON.stringify(hooksJson, null, 2), "utf-8")
  changes.push(`registered hooks in ${hooksPath}`)

  return changes
}

export function uninstallCodexAdapter(options: SetupOptions = {}): string[] {
  const changes: string[] = []
  const home = options.homeDir ?? homedir()
  const hooksCommand = (options.hooksCommand ?? defaultHooksCommand()).join(" ")

  const configTomlPath = join(home, ".codex", "config.toml")
  if (existsSync(configTomlPath)) {
    const toml = removeMcpSection(readFileSync(configTomlPath, "utf-8"))
    if (!options.dryRun) writeFileSync(configTomlPath, toml, "utf-8")
    changes.push(`removed MCP server ${MCP_SERVER_NAME} from ${configTomlPath}`)
  }

  const hooksPath = join(home, ".codex", "hooks.json")
  if (existsSync(hooksPath)) {
    const hooksJson = JSON.parse(readFileSync(hooksPath, "utf-8")) as { hooks?: Record<string, Array<Record<string, unknown>>> }
    removeHook(hooksJson, "UserPromptSubmit", hooksCommand)
    removeHook(hooksJson, "PreToolUse", hooksCommand)
    removeHook(hooksJson, "SessionEnd", hooksCommand)
    if (!options.dryRun) writeFileSync(hooksPath, JSON.stringify(hooksJson, null, 2), "utf-8")
    changes.push(`removed hooks from ${hooksPath}`)
  }

  const promptsDir = join(home, ".codex", "prompts")
  if (existsSync(promptsDir)) {
    for (const file of readdirSync(promptsDir)) {
      if (!file.endsWith(".md")) continue
      const path = join(promptsDir, file)
      if (readFileSync(path, "utf-8").includes(GENERATED_MARKER)) {
        if (!options.dryRun) rmSync(path)
        changes.push(`removed generated prompt ${path}`)
      }
    }
  }

  return changes
}

export function doctorCodexAdapter(options: SetupOptions = {}): string[] {
  const lines: string[] = []
  const home = options.homeDir ?? homedir()
  const configTomlPath = join(home, ".codex", "config.toml")
  const hooksPath = join(home, ".codex", "hooks.json")
  const promptsDir = join(home, ".codex", "prompts")

  if (!existsSync(configTomlPath) || !readFileSync(configTomlPath, "utf-8").includes(MCP_SECTION_HEADER)) {
    lines.push(`MCP server ${MCP_SERVER_NAME} is not registered in ${configTomlPath}`)
  }
  if (!existsSync(hooksPath) || !readFileSync(hooksPath, "utf-8").includes("cli-dispatch")) {
    lines.push(`hooks are not registered in ${hooksPath}`)
  }
  if (!existsSync(join(promptsDir, "opencode.md"))) {
    lines.push(`exit prompt is missing in ${promptsDir}`)
  }
  if (lines.length === 0) lines.push("Codex adapter looks healthy.")
  return lines
}
