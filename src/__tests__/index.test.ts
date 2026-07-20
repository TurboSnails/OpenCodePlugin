import { describe, it, expect, beforeEach, afterEach, spyOn } from "bun:test"
import { writeFileSync, mkdirSync, rmSync, existsSync } from "fs"
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

  it("registers delegate tools and no diagnostic tool when config is valid", async () => {
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

    const hooks = await createCliDispatchPlugin(configPath)({} as any)

    expect(hooks.tool).toBeDefined()
    expect(Object.keys(hooks.tool!)).toEqual(["myagent_start", "myagent_reply", "myagent_check"])
    expect(hooks.tool!.cli_dispatch_status).toBeUndefined()
  })

  it("registers only a diagnostic tool when config is broken", async () => {
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
    const hooks = await createCliDispatchPlugin(configPath)({} as any)
    expect(error).toHaveBeenCalled()
    error.mockRestore()

    expect(Object.keys(hooks.tool!)).toEqual(["cli_dispatch_status"])
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
      hooks = await createCliDispatchPlugin(configPath)({} as any)
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
})
