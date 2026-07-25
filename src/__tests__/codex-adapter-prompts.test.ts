import { describe, it, expect } from "bun:test"
import { generateCodexPrompts } from "../codex-adapter/prompts"
import { GENERATED_MARKER } from "../policy"
import { mkdtempSync, readFileSync, readdirSync, writeFileSync, rmSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"
import type { CodexAdapterConfig } from "../codex-adapter/config"

const config: CodexAdapterConfig = {
  delegates: {
    claude: {
      binary: "claude",
      parser: "claude",
      startArgs: ["-p", "--", "{prompt}"],
      replyArgs: ["-p", "--", "{prompt}"],
    },
  },
}

describe("generateCodexPrompts", () => {
  it("generates delegate and exit prompts with marker", () => {
    const dir = mkdtempSync(join(tmpdir(), "codex-prompts-"))
    generateCodexPrompts(config, dir)
    expect(readdirSync(dir).sort()).toEqual(["claude.md", "opencode.md"])
    expect(readFileSync(join(dir, "claude.md"), "utf-8")).toContain(GENERATED_MARKER)
    expect(readFileSync(join(dir, "opencode.md"), "utf-8")).toContain(GENERATED_MARKER)
    rmSync(dir, { recursive: true, force: true })
  })

  it("removes stale generated prompts but keeps hand-written ones", () => {
    const dir = mkdtempSync(join(tmpdir(), "codex-prompts-"))
    writeFileSync(join(dir, "old.md"), `${GENERATED_MARKER}\nstale`)
    writeFileSync(join(dir, "mine.md"), "hand written")
    generateCodexPrompts(config, dir)
    expect(readdirSync(dir).sort()).toEqual(["claude.md", "mine.md", "opencode.md"])
    rmSync(dir, { recursive: true, force: true })
  })
})
