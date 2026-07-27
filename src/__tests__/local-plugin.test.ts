import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync, existsSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"
import { createLocalCliDispatchPlugin } from "../local-plugin"

let dir: string
let originalDev: string | undefined

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "cli-dispatch-local-plugin-test-"))
  originalDev = process.env.CLI_DISPATCH_DEV
})

afterEach(() => {
  if (originalDev === undefined) delete process.env.CLI_DISPATCH_DEV
  else process.env.CLI_DISPATCH_DEV = originalDev
  rmSync(dir, { recursive: true, force: true })
})

function writeConfig(configPath: string): void {
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
}

describe("createLocalCliDispatchPlugin", () => {
  it("returns empty hooks when CLI_DISPATCH_DEV is not 1", async () => {
    delete process.env.CLI_DISPATCH_DEV
    const configPath = join(dir, "config.json")
    const commandsDir = join(dir, "commands")
    writeConfig(configPath)

    const hooks = await createLocalCliDispatchPlugin(configPath, { commandsDir })({} as any)

    expect(hooks).toEqual({})
    expect(existsSync(join(commandsDir, "myagent.md"))).toBe(false)
  })

  it("loads the local plugin when CLI_DISPATCH_DEV=1", async () => {
    process.env.CLI_DISPATCH_DEV = "1"
    const configPath = join(dir, "config.json")
    const commandsDir = join(dir, "commands")
    writeConfig(configPath)

    const hooks = await createLocalCliDispatchPlugin(configPath, { commandsDir })({} as any)

    expect(Object.keys(hooks.tool!)).toEqual([
      "myagent_start",
      "myagent_reply",
      "myagent_check",
      "cli_dispatch_doctor",
    ])
    expect(existsSync(join(commandsDir, "myagent.md"))).toBe(true)
  })
})
