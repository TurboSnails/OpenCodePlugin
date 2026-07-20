import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { writeFileSync, mkdirSync, rmSync, existsSync } from "fs"
import { join } from "path"
import { loadConfig, resolveArgs } from "../config"

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
