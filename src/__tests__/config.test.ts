import { describe, it, expect, beforeEach, afterEach, spyOn } from "bun:test"
import { writeFileSync, mkdirSync, rmSync, existsSync } from "fs"
import { join } from "path"
import { loadConfig, resolveArgs, isValidVerifiedModelEntry, matchesVerifiedModel } from "../config"

const TEST_DIR = join(import.meta.dir, "__test_config__")

describe("loadConfig", () => {
  beforeEach(() => {
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true })
    }
    mkdirSync(TEST_DIR, { recursive: true })
  })

  afterEach(() => {
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true })
    }
  })

  it("loads config from specified path", () => {
    const configPath = join(TEST_DIR, "config.json")
    writeFileSync(
      configPath,
      JSON.stringify({
        delegates: {
          myagent: {
            binary: "myagent",
            parser: "raw",
            startArgs: ["--", "{prompt}"],
            replyArgs: ["--", "{prompt}"],
          },
        },
      }),
    )

    const config = loadConfig(configPath)
    expect(config.delegates.myagent).toBeDefined()
    expect(config.delegates.myagent.binary).toBe("myagent")
    expect(config.delegates.myagent.parser).toBe("raw")
  })

  it("returns defaults when no config file found", () => {
    const config = loadConfig(join(TEST_DIR, "nonexistent.json"))
    expect(config.delegates.claude).toBeDefined()
    expect(config.delegates.codex).toBeDefined()
    expect(config.delegates.claude.startArgs).toContain("bypassPermissions")
    expect(config.delegates.codex.startArgs).toContain("sandbox_mode=workspace-write")
  })

  it("throws on invalid JSON", () => {
    const configPath = join(TEST_DIR, "bad.json")
    writeFileSync(configPath, "{ invalid json")

    expect(() => loadConfig(configPath)).toThrow("Failed to parse config")
  })

  it("throws on missing required fields", () => {
    const configPath = join(TEST_DIR, "incomplete.json")
    writeFileSync(
      configPath,
      JSON.stringify({
        delegates: {
          myagent: {
            binary: "myagent",
            // missing parser, startArgs, replyArgs
          },
        },
      }),
    )

    expect(() => loadConfig(configPath)).toThrow("Invalid config")
  })

  it("throws an error naming the delegate and the missing/invalid field", () => {
    const configPath = join(TEST_DIR, "field-errors.json")
    writeFileSync(
      configPath,
      JSON.stringify({
        delegates: {
          myagent: {
            binary: "myagent",
            // missing parser, startArgs, replyArgs
          },
        },
      }),
    )

    expect(() => loadConfig(configPath)).toThrow(/myagent/)
    expect(() => loadConfig(configPath)).toThrow(/parser/)
    expect(() => loadConfig(configPath)).toThrow(/startArgs/)
    expect(() => loadConfig(configPath)).toThrow(/replyArgs/)
  })

  it("throws on delegate names that would produce invalid tool names", () => {
    const configPath = join(TEST_DIR, "bad-name.json")
    writeFileSync(
      configPath,
      JSON.stringify({
        delegates: {
          "my agent": {
            binary: "myagent",
            parser: "raw",
            startArgs: ["--", "{prompt}"],
            replyArgs: ["--", "{prompt}"],
          },
        },
      }),
    )

    expect(() => loadConfig(configPath)).toThrow(/"my agent"/)
    expect(() => loadConfig(configPath)).toThrow(/name/i)
  })

  it("accepts delegate names with word characters and hyphens", () => {
    const configPath = join(TEST_DIR, "good-name.json")
    writeFileSync(
      configPath,
      JSON.stringify({
        delegates: {
          "my-agent_2": {
            binary: "myagent",
            parser: "raw",
            startArgs: ["--", "{prompt}"],
            replyArgs: ["--", "{prompt}"],
          },
        },
      }),
    )

    const config = loadConfig(configPath)
    expect(config.delegates["my-agent_2"]).toBeDefined()
  })

  it("throws when startArgs lacks the {prompt} placeholder", () => {
    const configPath = join(TEST_DIR, "no-prompt.json")
    writeFileSync(
      configPath,
      JSON.stringify({
        delegates: {
          myagent: {
            binary: "myagent",
            parser: "raw",
            startArgs: ["--json"],
            replyArgs: ["--", "{prompt}"],
          },
        },
      }),
    )

    expect(() => loadConfig(configPath)).toThrow(/startArgs/)
    expect(() => loadConfig(configPath)).toThrow(/\{prompt\}/)
  })

  it("warns but does not throw when replyArgs lacks the {externalId} placeholder", () => {
    const configPath = join(TEST_DIR, "no-external-id.json")
    writeFileSync(
      configPath,
      JSON.stringify({
        delegates: {
          myagent: {
            binary: "myagent",
            parser: "raw",
            startArgs: ["--", "{prompt}"],
            replyArgs: ["--", "{prompt}"],
          },
        },
      }),
    )

    const warn = spyOn(console, "warn").mockImplementation(() => {})
    try {
      const config = loadConfig(configPath)
      expect(config.delegates.myagent).toBeDefined()
      expect(warn).toHaveBeenCalled()
      const messages = warn.mock.calls.map((args) => String(args[0]))
      expect(messages.some((m) => m.includes("myagent") && m.includes("{externalId}"))).toBe(true)
    } finally {
      warn.mockRestore()
    }
  })

  it("accepts an optional timeoutMs per delegate", () => {
    const configPath = join(TEST_DIR, "with-timeout.json")
    writeFileSync(
      configPath,
      JSON.stringify({
        delegates: {
          myagent: {
            binary: "myagent",
            parser: "raw",
            startArgs: ["--", "{prompt}"],
            replyArgs: ["--", "{prompt}"],
            timeoutMs: 30000,
          },
        },
      }),
    )

    const config = loadConfig(configPath)
    expect(config.delegates.myagent.timeoutMs).toBe(30000)
  })

  it("throws on non-number timeoutMs", () => {
    const configPath = join(TEST_DIR, "bad-timeout-type.json")
    writeFileSync(
      configPath,
      JSON.stringify({
        delegates: {
          myagent: {
            binary: "myagent",
            parser: "raw",
            startArgs: ["--", "{prompt}"],
            replyArgs: ["--", "{prompt}"],
            timeoutMs: "30000",
          },
        },
      }),
    )

    expect(() => loadConfig(configPath)).toThrow("Invalid config")
  })

  it("throws on non-positive timeoutMs", () => {
    const configPath = join(TEST_DIR, "bad-timeout-value.json")
    writeFileSync(
      configPath,
      JSON.stringify({
        delegates: {
          myagent: {
            binary: "myagent",
            parser: "raw",
            startArgs: ["--", "{prompt}"],
            replyArgs: ["--", "{prompt}"],
            timeoutMs: -5,
          },
        },
      }),
    )

    expect(() => loadConfig(configPath)).toThrow("Invalid config")
  })

  it("accepts config without verifiedModels", () => {
    const configPath = join(TEST_DIR, "no-verified-models.json")
    writeFileSync(
      configPath,
      JSON.stringify({
        delegates: {
          myagent: { binary: "myagent", parser: "raw", startArgs: ["--", "{prompt}"], replyArgs: ["--", "{prompt}"] },
        },
      }),
    )

    const config = loadConfig(configPath)
    expect(config.verifiedModels).toBeUndefined()
  })

  it("accepts a valid verifiedModels list", () => {
    const configPath = join(TEST_DIR, "verified-models.json")
    writeFileSync(
      configPath,
      JSON.stringify({
        delegates: {
          myagent: { binary: "myagent", parser: "raw", startArgs: ["--", "{prompt}"], replyArgs: ["--", "{prompt}"] },
        },
        verifiedModels: ["anthropic/*", "moonshotai/kimi-for-coding-k3"],
      }),
    )

    const config = loadConfig(configPath)
    expect(config.verifiedModels).toEqual(["anthropic/*", "moonshotai/kimi-for-coding-k3"])
  })

  it("throws when verifiedModels is not an array", () => {
    const configPath = join(TEST_DIR, "verified-models-not-array.json")
    writeFileSync(
      configPath,
      JSON.stringify({
        delegates: {
          myagent: { binary: "myagent", parser: "raw", startArgs: ["--", "{prompt}"], replyArgs: ["--", "{prompt}"] },
        },
        verifiedModels: "anthropic/*",
      }),
    )

    expect(() => loadConfig(configPath)).toThrow(/verifiedModels/)
  })

  it("throws on a verifiedModels entry missing the provider/model shape", () => {
    const configPath = join(TEST_DIR, "verified-models-bad-shape.json")
    writeFileSync(
      configPath,
      JSON.stringify({
        delegates: {
          myagent: { binary: "myagent", parser: "raw", startArgs: ["--", "{prompt}"], replyArgs: ["--", "{prompt}"] },
        },
        verifiedModels: ["not-a-provider-model-pair"],
      }),
    )

    expect(() => loadConfig(configPath)).toThrow(/verifiedModels/)
    expect(() => loadConfig(configPath)).toThrow(/not-a-provider-model-pair/)
  })

  it("throws on a non-string verifiedModels entry", () => {
    const configPath = join(TEST_DIR, "verified-models-non-string.json")
    writeFileSync(
      configPath,
      JSON.stringify({
        delegates: {
          myagent: { binary: "myagent", parser: "raw", startArgs: ["--", "{prompt}"], replyArgs: ["--", "{prompt}"] },
        },
        verifiedModels: [42],
      }),
    )

    expect(() => loadConfig(configPath)).toThrow(/verifiedModels/)
  })
})

describe("isValidVerifiedModelEntry", () => {
  it("accepts an exact provider/model pair", () => {
    expect(isValidVerifiedModelEntry("anthropic/claude-sonnet-4-5")).toBe(true)
  })

  it("accepts a trailing wildcard on either segment", () => {
    expect(isValidVerifiedModelEntry("anthropic/*")).toBe(true)
    expect(isValidVerifiedModelEntry("*/kimi-for-coding-k3")).toBe(true)
    expect(isValidVerifiedModelEntry("*/*")).toBe(true)
  })

  it("rejects entries without exactly one slash", () => {
    expect(isValidVerifiedModelEntry("anthropic")).toBe(false)
    expect(isValidVerifiedModelEntry("anthropic/claude/extra")).toBe(false)
  })

  it("rejects non-string entries", () => {
    expect(isValidVerifiedModelEntry(42)).toBe(false)
    expect(isValidVerifiedModelEntry(null)).toBe(false)
    expect(isValidVerifiedModelEntry(["anthropic", "claude"])).toBe(false)
  })

  it("rejects empty segments", () => {
    expect(isValidVerifiedModelEntry("/claude")).toBe(false)
    expect(isValidVerifiedModelEntry("anthropic/")).toBe(false)
  })
})

describe("matchesVerifiedModel", () => {
  const model = { providerID: "anthropic", modelID: "claude-sonnet-4-5" }

  it("matches an exact provider/model pattern", () => {
    expect(matchesVerifiedModel(model, ["anthropic/claude-sonnet-4-5"])).toBe(true)
  })

  it("matches a trailing wildcard on the model segment", () => {
    expect(matchesVerifiedModel(model, ["anthropic/*"])).toBe(true)
  })

  it("matches a trailing wildcard on the provider segment", () => {
    expect(matchesVerifiedModel(model, ["*/claude-sonnet-4-5"])).toBe(true)
  })

  it("matches a partial trailing wildcard", () => {
    expect(matchesVerifiedModel(model, ["anthropic/claude-*"])).toBe(true)
  })

  it("does not match when no pattern applies", () => {
    expect(matchesVerifiedModel(model, ["minimax-cn/*", "kimi-for-coding/k3"])).toBe(false)
  })

  it("is case-sensitive", () => {
    expect(matchesVerifiedModel(model, ["Anthropic/*"])).toBe(false)
  })

  it("returns false for an empty pattern list", () => {
    expect(matchesVerifiedModel(model, [])).toBe(false)
  })
})

describe("resolveArgs", () => {
  it("replaces {prompt} placeholder", () => {
    const args = ["--", "{prompt}"]
    const result = resolveArgs(args, { prompt: "hello world" })
    expect(result).toEqual(["--", "hello world"])
  })

  it("replaces {sessionId} placeholder", () => {
    const args = ["--session-id", "{sessionId}"]
    const result = resolveArgs(args, { sessionId: "abc-123" })
    expect(result).toEqual(["--session-id", "abc-123"])
  })

  it("replaces {externalId} placeholder", () => {
    const args = ["--resume", "{externalId}"]
    const result = resolveArgs(args, { externalId: "xyz-789" })
    expect(result).toEqual(["--resume", "xyz-789"])
  })

  it("replaces multiple placeholders in same arg", () => {
    const args = ["{sessionId}-{externalId}"]
    const result = resolveArgs(args, { sessionId: "a", externalId: "b" })
    expect(result).toEqual(["a-b"])
  })

  it("leaves args without placeholders unchanged", () => {
    const args = ["--verbose", "--json"]
    const result = resolveArgs(args, { prompt: "hello" })
    expect(result).toEqual(["--verbose", "--json"])
  })
})
