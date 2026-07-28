import { describe, it, expect, beforeEach, afterEach, spyOn, mock } from "bun:test"
import { writeFileSync, mkdirSync, rmSync, existsSync, mkdtempSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"
import { createCliDispatchPlugin } from "../index"

const TEST_DIR = join(import.meta.dir, "__test_plugin__")

describe("createCliDispatchPlugin", () => {
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

  it("registers delegate tools and the diagnostic doctor tool when config is valid", async () => {
    const configPath = join(TEST_DIR, "config.json")
    writeFileSync(
      configPath,
      JSON.stringify({
        delegates: {
          myagent: {
            binary: "myagent",
            parser: "raw",
            startArgs: ["--", "{prompt}"],
            replyArgs: ["--resume", "{externalId}", "--", "{prompt}"],
          },
        },
      }),
    )

    const hooks = await createCliDispatchPlugin(configPath, { commandsDir: join(TEST_DIR, "commands") })({} as any)

    expect(hooks.tool).toBeDefined()
    expect(Object.keys(hooks.tool!)).toEqual([
      "myagent_start",
      "myagent_reply",
      "myagent_check",
      "cli_dispatch_doctor",
    ])
  })

  it("registers diagnostic tools when config is broken", async () => {
    const configPath = join(TEST_DIR, "broken.json")
    writeFileSync(
      configPath,
      JSON.stringify({
        delegates: {
          "bad agent": {
            binary: "bad",
            // missing parser, startArgs, replyArgs
          },
        },
      }),
    )

    const error = spyOn(console, "error").mockImplementation(() => {})
    const hooks = await createCliDispatchPlugin(configPath, { commandsDir: join(TEST_DIR, "commands") })({} as any)
    expect(error).toHaveBeenCalled()
    error.mockRestore()

    expect(Object.keys(hooks.tool!)).toEqual(["cli_dispatch_status", "cli_dispatch_doctor"])
    expect(hooks.tool!["bad agent_start"]).toBeUndefined()
  })

  it("diagnostic tool reports config path, validation errors, and fix guidance", async () => {
    const configPath = join(TEST_DIR, "broken.json")
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

    const error = spyOn(console, "error").mockImplementation(() => {})
    let hooks
    try {
      hooks = await createCliDispatchPlugin(configPath, { commandsDir: join(TEST_DIR, "commands") })({} as any)
    } finally {
      error.mockRestore()
    }

    const output = await hooks.tool!.cli_dispatch_status.execute({}, {} as any)
    expect(output).toContain(configPath)
    expect(output).toContain("myagent")
    expect(output).toContain("parser")
    expect(output).toContain("startArgs")
    expect(output).toContain("replyArgs")
    expect(output).toMatch(/fix|edit|restart/i)
  })

  it("warns but still loads when writing the load manifest fails", async () => {
    const badHome = join(TEST_DIR, "bad-home")
    writeFileSync(badHome, "not a dir")
    const configPath = join(TEST_DIR, "config.json")
    writeFileSync(
      configPath,
      JSON.stringify({
        delegates: {
          myagent: { binary: "myagent", parser: "raw", startArgs: ["--", "{prompt}"], replyArgs: ["--", "{prompt}"] },
        },
      }),
    )

    const realOs = await import("os")
    const warn = spyOn(console, "warn").mockImplementation(() => {})
    mock.module("os", () => ({ ...realOs, homedir: () => badHome }))
    try {
      const hooks = await createCliDispatchPlugin(configPath, { commandsDir: join(TEST_DIR, "commands") })({} as any)
      expect(Object.keys(hooks.tool!)).toContain("myagent_start")
      expect(warn).toHaveBeenCalled()
    } finally {
      warn.mockRestore()
      mock.restore()
    }
  })

  it("defaults commandsDir to ~/.config/opencode/commands when no option is given", async () => {
    const fakeHome = mkdtempSync(join(tmpdir(), "cli-dispatch-homedir-test-"))
    const configPath = join(TEST_DIR, "config.json")
    writeFileSync(
      configPath,
      JSON.stringify({
        delegates: {
          myagent: {
            binary: "myagent",
            parser: "raw",
            startArgs: ["--", "{prompt}"],
            replyArgs: ["--resume", "{externalId}", "--", "{prompt}"],
          },
        },
      }),
    )

    const realOs = await import("os")
    mock.module("os", () => ({ ...realOs, homedir: () => fakeHome }))
    try {
      await createCliDispatchPlugin(configPath)({} as any)
      expect(existsSync(join(fakeHome, ".config", "opencode", "commands", "myagent.md"))).toBe(true)
      expect(existsSync(join(TEST_DIR, "commands"))).toBe(false)
    } finally {
      mock.restore()
      rmSync(fakeHome, { recursive: true, force: true })
    }
  })
})
