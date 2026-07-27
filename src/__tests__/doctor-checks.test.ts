import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test"
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, chmodSync, existsSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"
import { makeContext, runChecks, applyFixes, which } from "../doctor/checks"
import type { DoctorContext, CheckResult } from "../doctor/checks"

let root: string
let home: string
let cwd: string
let bin: string

// Stub for the delegate runner so the writability probe never spawns a real CLI.
const stubRun: any = async () => ({ text: "ok", externalId: "x" })

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "cli-dispatch-doctor-test-"))
  home = join(root, "home")
  cwd = join(root, "cwd")
  bin = join(root, "bin")
  mkdirSync(home, { recursive: true })
  mkdirSync(cwd, { recursive: true })
  mkdirSync(bin, { recursive: true })
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

function ctx(overrides: Partial<DoctorContext> = {}): DoctorContext {
  return makeContext({ cwd, homeDir: home, pathEnv: bin, ...overrides })
}

function run(ctx: DoctorContext) {
  return runChecks(ctx, stubRun)
}

function writeFakeBinary(dir: string, name: string): void {
  const path = join(dir, name)
  writeFileSync(path, "#!/bin/sh\nexit 0\n")
  chmodSync(path, 0o755)
}

function byId(results: { id: string }[], id: string) {
  return results.find((r) => r.id === id)!
}

function failedResult(id: string, label: string): CheckResult {
  return { id, label, ok: false, detail: "missing" }
}

function configFileWithClaudeOnly(path: string): void {
  writeFileSync(
    path,
    JSON.stringify({
      delegates: {
        claude: {
          binary: "claude",
          parser: "claude",
          startArgs: ["-p", "--", "{prompt}"],
          replyArgs: ["-p", "--resume", "{externalId}", "--", "{prompt}"],
        },
      },
    }),
  )
}

describe("runChecks", () => {
  it("reports plugin as registered when a global opencode.json declares it", async () => {
    mkdirSync(join(home, ".config", "opencode"), { recursive: true })
    writeFileSync(
      join(home, ".config", "opencode", "opencode.json"),
      JSON.stringify({ plugin: ["opencode-cli-dispatch@github:TurboSnails/OpenCodePlugin"] }),
    )
    const results = await run(ctx())
    expect(byId(results, "plugin-registered").ok).toBe(true)
  })

  it("reports plugin as registered when a wrapper file references the package", async () => {
    mkdirSync(join(home, ".config", "opencode", "plugins"), { recursive: true })
    writeFileSync(
      join(home, ".config", "opencode", "plugins", "cli-dispatch.ts"),
      'import { createCliDispatchPlugin } from "opencode-cli-dispatch"\nexport default createCliDispatchPlugin()\n',
    )
    const results = await run(ctx())
    expect(byId(results, "plugin-registered").ok).toBe(true)
  })

  it("fails plugin-registered with a fix hint when nothing declares the plugin", async () => {
    const results = await run(ctx())
    const check = byId(results, "plugin-registered")
    expect(check.ok).toBe(false)
    expect(check.fixHint).toContain("opencode-cli-dispatch")
  })

  it("fails config-file when the config JSON is invalid", async () => {
    writeFileSync(join(cwd, "cli-dispatch.config.json"), "{ not json")
    const results = await run(ctx())
    const check = byId(results, "config-file")
    expect(check.ok).toBe(false)
    expect(check.detail).toContain("cli-dispatch.config.json")
  })

  it("passes config-file with a note when no config exists (built-in defaults)", async () => {
    const results = await run(ctx())
    const check = byId(results, "config-file")
    expect(check.ok).toBe(true)
    expect(check.detail).toContain("built-in defaults")
  })

  it("recognizes an absolute-path binary as found", async () => {
    const binaryPath = join(cwd, "custom-claude")
    writeFileSync(binaryPath, "#!/bin/sh\nexit 0\n")
    chmodSync(binaryPath, 0o755)
    const configPath = join(cwd, "cli-dispatch.config.json")
    writeFileSync(
      configPath,
      JSON.stringify({
        delegates: {
          claude: {
            binary: binaryPath,
            parser: "claude",
            startArgs: ["-p", "--", "{prompt}"],
            replyArgs: ["-p", "--resume", "{externalId}", "--", "{prompt}"],
          },
        },
      }),
    )
    const results = await run(ctx({ configPath }))
    const check = byId(results, "delegate-binaries")
    expect(check.ok).toBe(true)
    expect(check.detail).toContain("all delegate binaries found")
  })

  it("does not flag a hand-maintained cc.md as stale", async () => {
    const commandsDir = join(home, ".config", "opencode", "commands")
    mkdirSync(commandsDir, { recursive: true })
    // Generate managed commands so only cc.md is potentially different.
    applyFixes([failedResult("slash-commands", "Slash commands")], ctx())
    // Replace the generated cc.md with a hand-maintained file.
    writeFileSync(
      join(commandsDir, "cc.md"),
      "---\ndescription: My custom /cc\n---\n\nHand-maintained command.\n",
    )
    const results = await run(ctx())
    const check = byId(results, "slash-commands")
    expect(check.ok).toBe(true)
  })

  it("detects delegate binaries on PATH and reports missing ones", async () => {
    writeFakeBinary(bin, "claude")
    const results = await run(ctx())
    const check = byId(results, "delegate-binaries")
    expect(check.ok).toBe(false)
    expect(check.detail).toContain("codex")
    expect(check.detail).not.toContain("claude is missing")
  })

  it("checks credential files only for known CLIs", async () => {
    writeFakeBinary(bin, "claude")
    writeFakeBinary(bin, "codex")
    mkdirSync(join(home, ".codex"), { recursive: true })
    writeFileSync(join(home, ".codex", "auth.json"), "{}")
    const results = await run(ctx())
    const check = byId(results, "cli-authenticated")
    expect(check.ok).toBe(false)
    expect(check.detail).toContain("claude")
    expect(check.detail).not.toContain("codex is not authenticated")
  })

  it("fails slash-commands when the global commands dir is empty", async () => {
    const results = await run(ctx())
    const check = byId(results, "slash-commands")
    expect(check.ok).toBe(false)
  })

  it("fails plugin-tools when no delegates are configured", async () => {
    writeFileSync(join(cwd, "cli-dispatch.config.json"), JSON.stringify({ delegates: {} }))
    const results = await run(ctx())
    const tools = byId(results, "plugin-tools")
    expect(tools.ok).toBe(false)
    expect(tools.detail).toBe("no delegates configured")
    expect(tools.fixHint).toContain("cli-dispatch.config.json")
  })

  it("opencode-compat reads the version of the opencode binary resolved via ctx.pathEnv", async () => {
    const shim = join(bin, "opencode")
    writeFileSync(shim, "#!/bin/sh\necho 0.0.0-testshim\n")
    chmodSync(shim, 0o755)
    const results = await run(ctx())
    const compat = byId(results, "opencode-compat")
    expect(compat.detail).toContain("0.0.0")
    expect(compat.detail).not.toContain("skipped")
  })

  it("fails duplicate-plugin-registration when global config and an always-on local wrapper both load the plugin", async () => {
    mkdirSync(join(home, ".config", "opencode"), { recursive: true })
    writeFileSync(
      join(home, ".config", "opencode", "opencode.json"),
      JSON.stringify({ plugin: ["opencode-cli-dispatch@git+https://github.com/TurboSnails/OpenCodePlugin.git"] }),
    )
    mkdirSync(join(cwd, ".opencode", "plugin"), { recursive: true })
    writeFileSync(
      join(cwd, ".opencode", "plugin", "cli-dispatch.ts"),
      'import { createCliDispatchPlugin } from "../../src/index"\n\nexport default createCliDispatchPlugin()\n',
    )

    const results = await run(ctx())
    const check = byId(results, "duplicate-plugin-registration")
    expect(check.ok).toBe(false)
    expect(check.detail).toContain(".opencode/plugin/cli-dispatch.ts")
  })

  it("does not flag a dev-gated local wrapper when CLI_DISPATCH_DEV is unset", async () => {
    mkdirSync(join(home, ".config", "opencode"), { recursive: true })
    writeFileSync(
      join(home, ".config", "opencode", "opencode.json"),
      JSON.stringify({ plugin: ["opencode-cli-dispatch@git+https://github.com/TurboSnails/OpenCodePlugin.git"] }),
    )
    mkdirSync(join(cwd, ".opencode", "plugin"), { recursive: true })
    writeFileSync(
      join(cwd, ".opencode", "plugin", "cli-dispatch.ts"),
      'import { createLocalCliDispatchPlugin } from "../../src/local-plugin"\n\nexport default createLocalCliDispatchPlugin()\n',
    )

    const results = await run(ctx())
    expect(byId(results, "duplicate-plugin-registration").ok).toBe(true)
  })

  it("runs all nine checks in fixed order", async () => {
    const results = await run(ctx())
    expect(results.map((r) => r.id)).toEqual([
      "plugin-registered",
      "duplicate-plugin-registration",
      "config-file",
      "plugin-tools",
      "opencode-compat",
      "delegate-binaries",
      "cli-authenticated",
      "writability-probe",
      "slash-commands",
    ])
  })

  it("opencode-compat check is present and never crashes without opencode", async () => {
    const results = await run(ctx({ pathEnv: "" }))
    const compat = results.find((r) => r.id === "opencode-compat")
    expect(compat).toBeDefined()
    expect(compat!.ok).toBe(true)
    expect(compat!.detail).toContain("skipped")
  })

  it("plugin-tools check passes and lists delegate tools", async () => {
    const results = await run(ctx())
    const tools = results.find((r) => r.id === "plugin-tools")
    expect(tools).toBeDefined()
    expect(tools!.ok).toBe(true)
    expect(tools!.detail).toContain("claude_start")
    expect(tools!.detail).toContain("claude_reply")
    expect(tools!.detail).toContain("claude_check")
  })

  it("does not write generated commands into the user's commands dir", async () => {
    const realOs = await import("os")
    mock.module("os", () => ({ ...realOs, homedir: () => home }))
    try {
      const results = await run(ctx())
      expect(byId(results, "plugin-tools").ok).toBe(true)
      expect(existsSync(join(home, ".config", "opencode", "commands"))).toBe(false)
    } finally {
      mock.restore()
    }
  })

  it("preserves the check id and label when a check throws", async () => {
    mkdirSync(join(cwd, "opencode.json"), { recursive: true })
    const results = await run(ctx())
    const check = byId(results, "plugin-registered")
    expect(check.id).toBe("plugin-registered")
    expect(check.label).toBe("Plugin registered")
    expect(check.ok).toBe(false)
    expect(check.detail.toLowerCase()).toContain("directory")
  })
})

function stubPlatform(platform: string): () => void {
  const original = process.platform
  Object.defineProperty(process, "platform", { value: platform, configurable: true })
  return () => {
    Object.defineProperty(process, "platform", { value: original, configurable: true })
  }
}

describe("which", () => {
  it("returns false for a non-existent absolute path", () => {
    expect(which("/does/not/exist/claude", "")).toBe(false)
  })

  it("returns true for an existing absolute-path executable", () => {
    const binaryPath = join(cwd, "custom-delegate")
    writeFileSync(binaryPath, "#!/bin/sh\nexit 0\n")
    chmodSync(binaryPath, 0o755)
    expect(which(binaryPath, "")).toBe(true)
  })

  it("finds .cmd and .bat files on Windows without requiring execute access", () => {
    const restore = stubPlatform("win32")
    try {
      const winBin = join(bin, "claude.cmd")
      writeFileSync(winBin, "@echo off\n")
      // No chmod needed: F_OK only checks existence on Windows.
      expect(which("claude", bin)).toBe(true)

      const batBin = join(bin, "codex.bat")
      writeFileSync(batBin, "@echo off\n")
      expect(which("codex", bin)).toBe(true)
    } finally {
      restore()
    }
  })

  it("does not throw when checking an unreadable path", () => {
    expect(which(join("/root", "no-access"), "")).toBe(false)
  })
})

describe("applyFixes", () => {
  it("regenerates slash commands into the global commands dir", () => {
    const configPath = join(cwd, "cli-dispatch.config.json")
    configFileWithClaudeOnly(configPath)
    const results = applyFixes([failedResult("slash-commands", "Slash commands")], ctx())
    const fixed = byId(results, "slash-commands")
    expect(fixed.ok).toBe(true)
    expect(fixed.detail).toContain("regenerated")
    expect(existsSync(join(home, ".config", "opencode", "commands", "claude.md"))).toBe(true)
    expect(existsSync(join(home, ".config", "opencode", "commands", "opencode.md"))).toBe(true)
  })

  it("patches an existing opencode.json to add the plugin", () => {
    writeFileSync(join(cwd, "opencode.json"), JSON.stringify({ plugin: [] }))
    const results = applyFixes([failedResult("plugin-registered", "Plugin registered")], ctx())
    const fixed = byId(results, "plugin-registered")
    expect(fixed.ok).toBe(true)
    expect(fixed.detail).toContain("opencode-cli-dispatch")
    const updated = JSON.parse(readFileSync(join(cwd, "opencode.json"), "utf-8"))
    expect(updated.plugin).toContain("opencode-cli-dispatch")
  })

  it("patches an existing opencode.jsonc to add the plugin (comments are lost)", () => {
    writeFileSync(
      join(cwd, "opencode.jsonc"),
      "{\n  // project plugins\n  \"plugin\": [\"some-plugin\"]\n}\n",
    )
    const results = applyFixes([failedResult("plugin-registered", "Plugin registered")], ctx())
    const fixed = byId(results, "plugin-registered")
    expect(fixed.ok).toBe(true)
    expect(fixed.detail).toContain("opencode.jsonc")
    const updated = JSON.parse(readFileSync(join(cwd, "opencode.jsonc"), "utf-8"))
    expect(updated.plugin).toContain("opencode-cli-dispatch")
  })

  it("reports a manual fix hint for opencode.jsonc that cannot be parsed after stripping comments", () => {
    writeFileSync(join(cwd, "opencode.jsonc"), "{\n  // trailing comma is invalid after stripping\n  \"plugin\": [\"some-plugin\",]\n}\n")
    const results = applyFixes([failedResult("plugin-registered", "Plugin registered")], ctx())
    const fixed = byId(results, "plugin-registered")
    expect(fixed.ok).toBe(false)
    expect(fixed.detail).toContain("unsupported JSONC structure")
  })

  it("disables an old always-on dogfood wrapper after backing it up", async () => {
    mkdirSync(join(home, ".config", "opencode"), { recursive: true })
    writeFileSync(
      join(home, ".config", "opencode", "opencode.json"),
      JSON.stringify({ plugin: ["opencode-cli-dispatch@git+https://github.com/TurboSnails/OpenCodePlugin.git"] }),
    )
    const pluginDir = join(cwd, ".opencode", "plugin")
    mkdirSync(pluginDir, { recursive: true })
    const wrapper = join(pluginDir, "cli-dispatch.ts")
    writeFileSync(
      wrapper,
      'import { createCliDispatchPlugin } from "../../src/index"\n\nexport default createCliDispatchPlugin()\n',
    )

    const results = await run(ctx())
    const fixed = applyFixes(results, ctx())
    const check = byId(fixed, "duplicate-plugin-registration")

    expect(check.ok).toBe(true)
    expect(existsSync(`${wrapper}.bak`)).toBe(true)
    expect(existsSync(`${wrapper}.disabled`)).toBe(true)
    expect(existsSync(wrapper)).toBe(false)
  })

  it("leaves passing results unchanged", () => {
    const passing: CheckResult = {
      id: "delegate-binaries",
      label: "Delegate binaries",
      ok: true,
      detail: "all found",
    }
    const results = applyFixes([passing], ctx())
    expect(byId(results, "delegate-binaries")).toEqual(passing)
  })
})

describe("failure branches", () => {
  it("plugin-tools fails loudly when delegate tools are missing after simulated load", async () => {
    writeFileSync(join(cwd, "cli-dispatch.config.json"), JSON.stringify({
      delegates: {
        claude: { binary: "claude", parser: "claude", startArgs: ["{prompt}"], replyArgs: ["{prompt}"] },
      },
    }))
    const { checkPluginTools } = await import("../doctor/delegate-checks")
    const config = { delegates: { claude: { binary: "claude", parser: "claude" as const, startArgs: ["{prompt}"], replyArgs: ["{prompt}"] } } }
    const result = await checkPluginTools(ctx(), config, async () => ["claude_start"])
    expect(result.ok).toBe(false)
    expect(result.detail).toContain("claude_reply")
    expect(result.detail).toContain("claude_check")
    expect(result.fixHint).toContain("bun run build")
  })

  it("opencode-compat fails with fixHint when opencode minor version differs", async () => {
    const path = join(bin, "opencode")
    writeFileSync(path, "#!/bin/sh\necho 9.9.9\n")
    chmodSync(path, 0o755)
    const results = await run(ctx())
    const compat = byId(results, "opencode-compat")
    expect(compat.ok).toBe(false)
    expect(compat.detail).toContain("9.9.9")
    expect(compat.fixHint).toContain("@opencode-ai/plugin")
  })

  it("opencode-compat skips gracefully on unparseable opencode output", async () => {
    const path = join(bin, "opencode")
    writeFileSync(path, "#!/bin/sh\necho garbage\n")
    chmodSync(path, 0o755)
    const results = await run(ctx())
    const compat = byId(results, "opencode-compat")
    expect(compat.ok).toBe(true)
    expect(compat.detail).toContain("skipped")
  })

  it("plugin-tools simulated load uses the passed config, not ambient search paths", async () => {
    const { checkPluginTools } = await import("../doctor/delegate-checks")
    const config = {
      delegates: {
        ghost: { binary: "ghost", parser: "raw" as const, startArgs: ["--", "{prompt}"], replyArgs: ["--", "{prompt}"] },
      },
    }
    const result = await checkPluginTools(ctx(), config)
    expect(result.ok).toBe(true)
    expect(result.detail).toContain("ghost_start")
  })
})
