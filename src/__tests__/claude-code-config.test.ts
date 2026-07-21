import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { writeFileSync, mkdtempSync, rmSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"
import { loadAdapterConfig, isValidModelPattern, matchesModelPattern } from "../claude-code-adapter/config"

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "cli-dispatch-adapter-config-test-"))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe("isValidModelPattern", () => {
  it("accepts a bare model string", () => {
    expect(isValidModelPattern("claude-sonnet-5")).toBe(true)
  })

  it("accepts a trailing wildcard", () => {
    expect(isValidModelPattern("claude-*")).toBe(true)
    expect(isValidModelPattern("*")).toBe(true)
  })

  it("rejects non-string entries", () => {
    expect(isValidModelPattern(42)).toBe(false)
    expect(isValidModelPattern(null)).toBe(false)
  })

  it("rejects an empty string", () => {
    expect(isValidModelPattern("")).toBe(false)
  })
})

describe("matchesModelPattern", () => {
  it("matches an exact string", () => {
    expect(matchesModelPattern("claude-sonnet-5", ["claude-sonnet-5"])).toBe(true)
  })

  it("matches a trailing wildcard", () => {
    expect(matchesModelPattern("claude-sonnet-5", ["claude-*"])).toBe(true)
  })

  it("does not match an unrelated pattern", () => {
    expect(matchesModelPattern("claude-sonnet-5", ["gpt-*"])).toBe(false)
  })

  it("is case-sensitive", () => {
    expect(matchesModelPattern("claude-sonnet-5", ["Claude-*"])).toBe(false)
  })

  it("returns false for an empty pattern list", () => {
    expect(matchesModelPattern("claude-sonnet-5", [])).toBe(false)
  })
})

describe("loadAdapterConfig", () => {
  it("loads a valid config", () => {
    const path = join(dir, "config.json")
    writeFileSync(
      path,
      JSON.stringify({
        delegates: {
          codex: { binary: "codex", parser: "codex", startArgs: ["exec", "--", "{prompt}"], replyArgs: ["exec", "resume", "{externalId}", "--", "{prompt}"] },
        },
        verifiedModels: ["claude-*"],
      }),
    )
    const config = loadAdapterConfig(path)
    expect(config.delegates.codex.binary).toBe("codex")
    expect(config.verifiedModels).toEqual(["claude-*"])
  })

  it("throws when the config file doesn't exist", () => {
    expect(() => loadAdapterConfig(join(dir, "nonexistent.json"))).toThrow(/not found/)
  })

  it("throws on invalid JSON", () => {
    const path = join(dir, "bad.json")
    writeFileSync(path, "{ invalid")
    expect(() => loadAdapterConfig(path)).toThrow(/Failed to parse/)
  })

  it("throws on an invalid delegate, reusing validateDelegates", () => {
    const path = join(dir, "bad-delegate.json")
    writeFileSync(path, JSON.stringify({ delegates: { codex: { binary: "codex" } } }))
    expect(() => loadAdapterConfig(path)).toThrow(/parser/)
  })

  it("throws on an invalid verifiedModels entry", () => {
    const path = join(dir, "bad-verified-models.json")
    writeFileSync(
      path,
      JSON.stringify({
        delegates: { codex: { binary: "codex", parser: "codex", startArgs: ["{prompt}"], replyArgs: ["{externalId}"] } },
        verifiedModels: [42],
      }),
    )
    expect(() => loadAdapterConfig(path)).toThrow(/verifiedModels/)
  })

  it("allows an absent verifiedModels field", () => {
    const path = join(dir, "no-verified-models.json")
    writeFileSync(
      path,
      JSON.stringify({
        delegates: { codex: { binary: "codex", parser: "codex", startArgs: ["{prompt}"], replyArgs: ["{externalId}"] } },
      }),
    )
    const config = loadAdapterConfig(path)
    expect(config.verifiedModels).toBeUndefined()
  })
})
