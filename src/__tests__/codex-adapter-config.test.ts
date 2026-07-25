import { describe, it, expect } from "bun:test"
import { isValidModelPattern, matchesModelPattern, loadCodexAdapterConfig, getCodexConfigSearchPaths } from "../codex-adapter/config"
import { mkdirSync, writeFileSync, rmSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"

describe("isValidModelPattern", () => {
  it("accepts exact slugs, wildcard suffixes, and lone star", () => {
    expect(isValidModelPattern("gpt-5.6-sol")).toBe(true)
    expect(isValidModelPattern("gpt-*")).toBe(true)
    expect(isValidModelPattern("*")).toBe(true)
    expect(isValidModelPattern("provider/model")).toBe(false)
    expect(isValidModelPattern("")).toBe(false)
    expect(isValidModelPattern(123)).toBe(false)
  })
})

describe("matchesModelPattern", () => {
  it("matches exact, prefix wildcard, and star", () => {
    expect(matchesModelPattern("gpt-5.6-sol", ["gpt-5.6-sol"])).toBe(true)
    expect(matchesModelPattern("gpt-5.6-sol", ["gpt-*"])).toBe(true)
    expect(matchesModelPattern("gpt-5.6-sol", ["*"])).toBe(true)
    expect(matchesModelPattern("gpt-5.6-sol", ["claude-*"])).toBe(false)
  })
})

describe("getCodexConfigSearchPaths", () => {
  it("returns codex-adapter paths before falling back", () => {
    const paths = getCodexConfigSearchPaths(undefined, "/proj", "/home")
    expect(paths).toEqual([
      "/proj/codex-adapter.config.json",
      "/proj/.codex/cli-dispatch.config.json",
      "/home/.codex/cli-dispatch.config.json",
    ])
  })
})

describe("loadCodexAdapterConfig", () => {
  it("rejects a delegate named opencode", () => {
    const dir = join(tmpdir(), `codex-adapter-config-${Date.now()}`)
    mkdirSync(dir, { recursive: true })
    const path = join(dir, "codex-adapter.config.json")
    writeFileSync(
      path,
      JSON.stringify({
        delegates: {
          opencode: {
            binary: "opencode",
            parser: "opencode",
            startArgs: ["run", "--", "{prompt}"],
            replyArgs: ["run", "--", "{prompt}"],
          },
        },
      }),
    )
    expect(() => loadCodexAdapterConfig(path)).toThrow(/opencode.*not supported/)
    rmSync(dir, { recursive: true, force: true })
  })

  it("falls back to cli-dispatch.config.json delegates when no codex-adapter config exists", () => {
    const dir = join(tmpdir(), `codex-adapter-fallback-${Date.now()}`)
    mkdirSync(dir, { recursive: true })
    writeFileSync(
      join(dir, "cli-dispatch.config.json"),
      JSON.stringify({
        delegates: {
          claude: {
            binary: "claude",
            parser: "claude",
            startArgs: ["-p", "--", "{prompt}"],
            replyArgs: ["-p", "--", "{prompt}"],
          },
        },
      }),
    )
    const cwd = process.cwd()
    process.chdir(dir)
    try {
      const config = loadCodexAdapterConfig()
      expect(config.delegates.claude?.binary).toBe("claude")
      expect(config.verifiedModels).toBeUndefined()
    } finally {
      process.chdir(cwd)
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
