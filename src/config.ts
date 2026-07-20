import { readFileSync, existsSync } from "fs"
import { join } from "path"

export type ParserName = "claude" | "codex" | "raw"

export interface DelegateConfig {
  binary: string
  parser: ParserName
  startArgs: string[]
  replyArgs: string[]
  timeoutMs?: number
}

export interface CliDispatchConfig {
  delegates: Record<string, DelegateConfig>
}

const DEFAULT_CONFIG: CliDispatchConfig = {
  delegates: {
    claude: {
      binary: "claude",
      parser: "claude",
      startArgs: [
        "-p",
        "--output-format",
        "stream-json",
        "--verbose",
        "--permission-mode",
        "bypassPermissions",
        "--session-id",
        "{sessionId}",
        "--",
        "{prompt}",
      ],
      replyArgs: [
        "-p",
        "--output-format",
        "stream-json",
        "--verbose",
        "--permission-mode",
        "bypassPermissions",
        "--resume",
        "{externalId}",
        "--",
        "{prompt}",
      ],
    },
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
  },
}

function validateConfig(config: unknown): config is CliDispatchConfig {
  if (typeof config !== "object" || config === null) {
    return false
  }

  const obj = config as Record<string, unknown>
  if (typeof obj.delegates !== "object" || obj.delegates === null) {
    return false
  }

  const delegates = obj.delegates as Record<string, unknown>
  for (const [name, delegate] of Object.entries(delegates)) {
    if (typeof delegate !== "object" || delegate === null) {
      console.error(`Invalid delegate config for "${name}": must be an object`)
      return false
    }

    const d = delegate as Record<string, unknown>
    if (typeof d.binary !== "string") {
      console.error(`Invalid delegate config for "${name}": missing or invalid "binary" field`)
      return false
    }

    if (typeof d.parser !== "string" || !["claude", "codex", "raw"].includes(d.parser)) {
      console.error(`Invalid delegate config for "${name}": "parser" must be "claude", "codex", or "raw"`)
      return false
    }

    if (!Array.isArray(d.startArgs) || !d.startArgs.every((a) => typeof a === "string")) {
      console.error(`Invalid delegate config for "${name}": "startArgs" must be an array of strings`)
      return false
    }

    if (!Array.isArray(d.replyArgs) || !d.replyArgs.every((a) => typeof a === "string")) {
      console.error(`Invalid delegate config for "${name}": "replyArgs" must be an array of strings`)
      return false
    }

    if (d.timeoutMs !== undefined && (typeof d.timeoutMs !== "number" || !(d.timeoutMs > 0))) {
      console.error(`Invalid delegate config for "${name}": "timeoutMs" must be a positive number`)
      return false
    }
  }

  return true
}

export function loadConfig(configPath?: string): CliDispatchConfig {
  const searchPaths = configPath
    ? [configPath]
    : [
        join(process.cwd(), "cli-dispatch.config.json"),
        join(process.cwd(), ".opencode", "cli-dispatch.config.json"),
        join(process.cwd(), ".opencode", "lib", "cli-dispatch", "config.json"),
      ]

  for (const path of searchPaths) {
    if (existsSync(path)) {
      try {
        const raw = readFileSync(path, "utf-8")
        const config = JSON.parse(raw)

        if (!validateConfig(config)) {
          throw new Error(`Invalid config at ${path}`)
        }

        return config
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

export function resolveArgs(args: string[], vars: Record<string, string>): string[] {
  return args.map((arg) => {
    let result = arg
    for (const [key, value] of Object.entries(vars)) {
      result = result.replaceAll(`{${key}}`, value)
    }
    return result
  })
}
