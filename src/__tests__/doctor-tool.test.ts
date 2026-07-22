import { describe, it, expect } from "bun:test"
import { mkdtempSync, mkdirSync, rmSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"
import { makeDoctorTool } from "../doctor/tool"

describe("makeDoctorTool", () => {
  it("returns a report string covering all six check ids", async () => {
    const root = mkdtempSync(join(tmpdir(), "cli-dispatch-doctor-tool-"))
    try {
      const homeDir = join(root, "home")
      const cwd = join(root, "cwd")
      mkdirSync(homeDir, { recursive: true })
      mkdirSync(cwd, { recursive: true })
      const stubRun: any = async () => ({ text: "ok", externalId: "x" })
      const tool = makeDoctorTool(stubRun, { cwd, homeDir, pathEnv: join(root, "bin") })
      const report: string = await tool.execute({}, { sessionID: "s1" } as any)
      for (const id of ["plugin-registered", "config-file", "delegate-binaries", "cli-authenticated", "writability-probe", "slash-commands"]) {
        expect(report).toContain(id)
      }
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
