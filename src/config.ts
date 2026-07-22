import { readFileSync, existsSync } from "fs"
import { join } from "path"
import { homedir } from "os"
import { validateArgvInjection } from "./policy"

export type ParserName = "claude" | "codex" | "opencode" | "raw"

export interface DelegateConfig {
  binary: string
  parser: ParserName
  startArgs: string[]
  replyArgs: string[]
  timeoutMs?: number
}

export interface CliDispatchConfig {
  delegates: Record<string, DelegateConfig>
  verifiedModels?: string[]
}

// Each segment is one or more word/dot/hyphen characters, or a lone "*",
// optionally ending in a trailing "*" wildcard (e.g. "anthropic", "*",
// "kimi-for-coding-k3*").
const VERIFIED_MODEL_SEGMENT_RE = /^(\*|[\w.-]+\*?)$/

export function isValidVerifiedModelEntry(entry: unknown): entry is string {
  if (typeof entry !== "string") return false
  const parts = entry.split("/")
  if (parts.length !== 2) return false
  const [provider, model] = parts
  return VERIFIED_MODEL_SEGMENT_RE.test(provider) && VERIFIED_MODEL_SEGMENT_RE.test(model)
}

function matchesSegment(actual: string, pattern: string): boolean {
  if (pattern === "*") return true
  if (pattern.endsWith("*")) return actual.startsWith(pattern.slice(0, -1))
  return actual === pattern
}

export function matchesVerifiedModel(model: { providerID: string; modelID: string }, patterns: string[]): boolean {
  return patterns.some((pattern) => {
    const [provider, modelPattern] = pattern.split("/")
    return matchesSegment(model.providerID, provider) && matchesSegment(model.modelID, modelPattern)
  })
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
        "acceptEdits",
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
        "acceptEdits",
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
        "--json",
        "-c",
        "sandbox_mode=workspace-write",
        "--skip-git-repo-check",
        "--",
        "{externalId}",
        "{prompt}",
      ],
    },
  },
}

export function validateDelegates(delegates: Record<string, unknown>): string[] {
  const errors: string[] = []
  for (const [name, delegate] of Object.entries(delegates)) {
    if (!/^[\w-]+$/.test(name)) {
      errors.push(`delegate "${name}": name must match /^[\\w-]+$/ (letters, digits, underscore, hyphen) or it would produce invalid tool names`)
    }

    if (typeof delegate !== "object" || delegate === null) {
      errors.push(`delegate "${name}": must be an object`)
      continue
    }

    const d = delegate as Record<string, unknown>
    if (typeof d.binary !== "string") {
      errors.push(`delegate "${name}": missing or invalid "binary" field`)
    }

    if (typeof d.parser !== "string" || !["claude", "codex", "opencode", "raw"].includes(d.parser)) {
      errors.push(`delegate "${name}": "parser" must be "claude", "codex", "opencode", or "raw"`)
    }

    if (!Array.isArray(d.startArgs) || !d.startArgs.every((a) => typeof a === "string")) {
      errors.push(`delegate "${name}": "startArgs" must be an array of strings`)
    } else {
      if (!d.startArgs.some((a) => a.includes("{prompt}"))) {
        errors.push(`delegate "${name}": "startArgs" must contain the {prompt} placeholder, otherwise the CLI runs without the user's task`)
      }
      const argvError = validateArgvInjection(name, "startArgs", d.startArgs as string[])
      if (argvError) errors.push(argvError)
    }

    if (!Array.isArray(d.replyArgs) || !d.replyArgs.every((a) => typeof a === "string")) {
      errors.push(`delegate "${name}": "replyArgs" must be an array of strings`)
    } else {
      if (!d.replyArgs.some((a) => a.includes("{externalId}"))) {
        // Warning only: a raw delegate without any session concept may
        // legitimately have nothing to resume.
        console.warn(`[cli-dispatch] delegate "${name}": "replyArgs" has no {externalId} placeholder; ${name}_reply will not be able to resume a session`)
      }
      const argvError = validateArgvInjection(name, "replyArgs", d.replyArgs as string[])
      if (argvError) errors.push(argvError)
    }

    if (d.timeoutMs !== undefined && (typeof d.timeoutMs !== "number" || !(d.timeoutMs > 0))) {
      errors.push(`delegate "${name}": "timeoutMs" must be a positive number`)
    }
  }

  return errors
}

function validateConfig(config: unknown): string[] {
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
      errors.push('"verifiedModels" must be an array of "provider/model" strings')
    } else {
      for (const entry of obj.verifiedModels) {
        if (!isValidVerifiedModelEntry(entry)) {
          errors.push(`"verifiedModels" entry ${JSON.stringify(entry)} must be a "provider/model" string, each segment optionally ending in a trailing "*" wildcard`)
        }
      }
    }
  }

  errors.push(...validateDelegates(obj.delegates as Record<string, unknown>))

  return errors
}

export function getConfigSearchPaths(
  configPath?: string,
  homeDir: string = homedir(),
  cwd: string = process.cwd(),
): string[] {
  if (configPath) return [configPath]
  return [
    join(cwd, "cli-dispatch.config.json"),
    join(cwd, ".opencode", "cli-dispatch.config.json"),
    join(cwd, ".opencode", "lib", "cli-dispatch", "config.json"),
    join(homeDir, ".config", "opencode", "cli-dispatch.config.json"),
  ]
}

export function loadConfig(configPath?: string): CliDispatchConfig {
  const searchPaths = getConfigSearchPaths(configPath)

  for (const path of searchPaths) {
    if (existsSync(path)) {
      try {
        const raw = readFileSync(path, "utf-8")
        const config = JSON.parse(raw)

        const errors = validateConfig(config)
        if (errors.length > 0) {
          throw new Error(`Invalid config at ${path}:\n  - ${errors.join("\n  - ")}`)
        }

        return config as CliDispatchConfig
      } catch (err) {
        if (err instanceof SyntaxError) {
          throw new Error(`Failed to parse config at ${path}: ${err.message}`)
        }
        throw err
      }
    }
  }

  console.warn(
    "[cli-dispatch] No cli-dispatch.config.json found; using safe built-in defaults (claude runs with --permission-mode acceptEdits, codex with sandbox_mode=workspace-write). Place cli-dispatch.config.json in your project root to configure delegates; an explicit bypassPermissions entry remains available as an opt-in escalation.",
  )
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
