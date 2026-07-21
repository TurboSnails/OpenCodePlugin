import { readFileSync, existsSync } from "fs"
import { validateDelegates, type DelegateConfig } from "../config"

export const MCP_SERVER_NAME = "cli-dispatch"
export const MCP_TOOL_PREFIX = `mcp__${MCP_SERVER_NAME}__`

export interface ClaudeCodeAdapterConfig {
  delegates: Record<string, DelegateConfig>
  verifiedModels?: string[]
}

const MODEL_PATTERN_RE = /^(\*|[\w.-]+\*?)$/

export function isValidModelPattern(entry: unknown): entry is string {
  return typeof entry === "string" && entry.length > 0 && MODEL_PATTERN_RE.test(entry)
}

export function matchesModelPattern(model: string, patterns: string[]): boolean {
  return patterns.some((pattern) => {
    if (pattern === "*") return true
    if (pattern.endsWith("*")) return model.startsWith(pattern.slice(0, -1))
    return model === pattern
  })
}

function validateAdapterConfig(config: unknown): string[] {
  const errors: string[] = []

  if (typeof config !== "object" || config === null) {
    return ["config must be an object"]
  }

  const obj = config as Record<string, unknown>
  if (typeof obj.delegates !== "object" || obj.delegates === null) {
    return ['"delegates" must be an object']
  }

  if (obj.verifiedModels !== undefined) {
    if (!Array.isArray(obj.verifiedModels)) {
      errors.push('"verifiedModels" must be an array of model-name strings')
    } else {
      for (const entry of obj.verifiedModels) {
        if (!isValidModelPattern(entry)) {
          errors.push(`"verifiedModels" entry ${JSON.stringify(entry)} must be a model-name string, optionally ending in a trailing "*" wildcard`)
        }
      }
    }
  }

  errors.push(...validateDelegates(obj.delegates as Record<string, unknown>))
  return errors
}

export function loadAdapterConfig(configPath?: string): ClaudeCodeAdapterConfig {
  const path = configPath ?? `${process.cwd()}/claude-code-adapter.config.json`

  if (!existsSync(path)) {
    throw new Error(`Claude Code adapter config not found at ${path}. Create it with at least a "delegates" object (e.g. codex/opencode).`)
  }

  const raw = readFileSync(path, "utf-8")
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (err) {
    throw new Error(`Failed to parse config at ${path}: ${err instanceof Error ? err.message : String(err)}`)
  }

  const errors = validateAdapterConfig(parsed)
  if (errors.length > 0) {
    throw new Error(`Invalid config at ${path}:\n  - ${errors.join("\n  - ")}`)
  }

  return parsed as ClaudeCodeAdapterConfig
}
