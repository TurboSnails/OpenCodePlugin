import { readFileSync, existsSync } from "fs"
import { join } from "path"
import { validateDelegates, type DelegateConfig } from "../config"

export interface ClaudeCodeAdapterConfig {
  delegates: Record<string, DelegateConfig>
  // Bare model-string patterns (e.g. "claude-sonnet-5", "claude-*") — Claude
  // Code exposes no provider dimension, unlike OpenCode's "provider/model"
  // pairs (design.md D7).
  verifiedModels?: string[]
}

// One or more word/dot/hyphen characters, optionally ending in a trailing "*"
// wildcard (e.g. "claude-sonnet-5", "claude-*"), or a lone "*".
const MODEL_PATTERN_RE = /^(\*|[\w.-]+\*?)$/

export function isValidModelPattern(entry: unknown): entry is string {
  return typeof entry === "string" && MODEL_PATTERN_RE.test(entry)
}

export function matchesModelPattern(model: string, patterns: string[]): boolean {
  return patterns.some((pattern) => {
    if (pattern === "*") return true
    if (pattern.endsWith("*")) return model.startsWith(pattern.slice(0, -1))
    return model === pattern
  })
}

const DEFAULT_CONFIG: ClaudeCodeAdapterConfig = {
  delegates: {
    codex: {
      binary: "codex",
      parser: "codex",
      startArgs: ["exec", "--json", "-c", "sandbox_mode=workspace-write", "--skip-git-repo-check", "--", "{prompt}"],
      replyArgs: [
        "exec",
        "resume",
        "{externalId}",
        "--json",
        "-c",
        "sandbox_mode=workspace-write",
        "--skip-git-repo-check",
        "--",
        "{prompt}",
      ],
    },
    opencode: {
      binary: "opencode",
      parser: "opencode",
      startArgs: ["run", "--format", "json", "{prompt}"],
      replyArgs: ["run", "--format", "json", "-s", "{externalId}", "-c", "{prompt}"],
    },
  },
}

function validateAdapterConfig(config: unknown): string[] {
  if (typeof config !== "object" || config === null) {
    return ["config must be an object"]
  }

  const obj = config as Record<string, unknown>
  if (typeof obj.delegates !== "object" || obj.delegates === null) {
    return ['"delegates" must be an object']
  }

  const errors: string[] = []

  if (obj.verifiedModels !== undefined) {
    if (!Array.isArray(obj.verifiedModels)) {
      errors.push('"verifiedModels" must be an array of model-string patterns')
    } else {
      for (const entry of obj.verifiedModels) {
        if (!isValidModelPattern(entry)) {
          errors.push(`"verifiedModels" entry ${JSON.stringify(entry)} must be a bare model string, optionally ending in a trailing "*" wildcard`)
        }
      }
    }
  }

  errors.push(...validateDelegates(obj.delegates as Record<string, unknown>))

  return errors
}

export function loadAdapterConfig(configPath?: string): ClaudeCodeAdapterConfig {
  const searchPaths = configPath
    ? [configPath]
    : [join(process.cwd(), "claude-code-adapter.config.json")]

  for (const path of searchPaths) {
    if (existsSync(path)) {
      try {
        const raw = readFileSync(path, "utf-8")
        const config = JSON.parse(raw)

        const errors = validateAdapterConfig(config)
        if (errors.length > 0) {
          throw new Error(`Invalid config at ${path}:\n  - ${errors.join("\n  - ")}`)
        }

        return config as ClaudeCodeAdapterConfig
      } catch (err) {
        if (err instanceof SyntaxError) {
          throw new Error(`Failed to parse config at ${path}: ${err.message}`)
        }
        throw err
      }
    }
  }

  return DEFAULT_CONFIG
}
