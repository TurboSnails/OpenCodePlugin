import { describe, it, expect } from "bun:test"
import { setupCodexAdapter, uninstallCodexAdapter, doctorCodexAdapter } from "../codex-adapter/setup"
import { mkdtempSync, readFileSync, existsSync, rmSync } from "fs"
import { join } from "path"
import { tmpdir, homedir } from "os"

describe("setupCodexAdapter", () => {
  it("writes mcp config, hooks, and prompts under a fake home", () => {
    const home = mkdtempSync(join(tmpdir(), "codex-setup-"))
    const changes = setupCodexAdapter({ homeDir: home, dryRun: false })
    expect(changes.length).toBeGreaterThan(0)
    expect(readFileSync(join(home, ".codex", "config.toml"), "utf-8")).toContain("[mcp_servers.cli_dispatch]")
    const hooks = readFileSync(join(home, ".codex", "hooks.json"), "utf-8")
    expect(hooks).toContain("UserPromptSubmit")
    expect(hooks).toContain("PreToolUse")
    expect(hooks).toContain("SessionEnd")
    expect(hooks).toContain("mcp__cli_dispatch__.*")
    expect(existsSync(join(home, ".codex", "prompts", "opencode.md"))).toBe(true)
    expect(doctorCodexAdapter({ homeDir: home })).toEqual(["Codex adapter looks healthy."])
    rmSync(home, { recursive: true, force: true })
  })

  it("dry-run does not write files", () => {
    const home = mkdtempSync(join(tmpdir(), "codex-setup-"))
    setupCodexAdapter({ homeDir: home, dryRun: true })
    expect(existsSync(join(home, ".codex", "config.toml"))).toBe(false)
    rmSync(home, { recursive: true, force: true })
  })

  it("creates the state dir under homeDir, not the real home", () => {
    const home = mkdtempSync(join(tmpdir(), "codex-setup-"))
    const changes = setupCodexAdapter({ homeDir: home, dryRun: false })
    expect(existsSync(join(home, ".codex", "cli-dispatch"))).toBe(true)
    expect(changes.some((c) => c.includes(join(home, ".codex", "cli-dispatch")))).toBe(true)
    expect(changes.some((c) => c.includes(join(homedir(), ".codex", "cli-dispatch")))).toBe(false)
    rmSync(home, { recursive: true, force: true })
  })

  it("shell-quotes the hook command segments", () => {
    const home = mkdtempSync(join(tmpdir(), "codex-setup-"))
    setupCodexAdapter({ homeDir: home, dryRun: false, hooksCommand: ["bun", "run", "/path/with spaces/hooks.js"] })
    const hooksJson = JSON.parse(readFileSync(join(home, ".codex", "hooks.json"), "utf-8")) as {
      hooks: Record<string, Array<{ hooks: Array<{ command: string }> }>>
    }
    expect(hooksJson.hooks.UserPromptSubmit[0].hooks[0].command).toBe('"bun" "run" "/path/with spaces/hooks.js"')
    rmSync(home, { recursive: true, force: true })
  })
})

describe("uninstallCodexAdapter", () => {
  it("removes generated artifacts", () => {
    const home = mkdtempSync(join(tmpdir(), "codex-setup-"))
    setupCodexAdapter({ homeDir: home, dryRun: false })
    uninstallCodexAdapter({ homeDir: home, dryRun: false })
    expect(readFileSync(join(home, ".codex", "config.toml"), "utf-8")).not.toContain("[mcp_servers.cli_dispatch]")
    expect(readFileSync(join(home, ".codex", "hooks.json"), "utf-8")).not.toContain("cli-dispatch")
    expect(existsSync(join(home, ".codex", "prompts", "opencode.md"))).toBe(false)
    rmSync(home, { recursive: true, force: true })
  })
})

describe("doctorCodexAdapter", () => {
  it("reports missing pieces", () => {
    const home = mkdtempSync(join(tmpdir(), "codex-setup-"))
    const lines = doctorCodexAdapter({ homeDir: home })
    expect(lines.some((l) => l.includes("missing") || l.includes("not registered"))).toBe(true)
    rmSync(home, { recursive: true, force: true })
  })
})
