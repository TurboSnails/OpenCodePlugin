import { describe, it, expect } from "bun:test"
import { runDelegate, type SpawnFn, type SpawnOptions } from "../run-delegate"

function fakeSpawn(stdoutLines: string[], stderrLines: string[] = [], exitCode = 0): SpawnFn {
  return () => ({
    stdout: new Response(stdoutLines.map((l) => l + "\n").join("")).body!,
    stderr: new Response(stderrLines.map((l) => l + "\n").join("")).body!,
    exited: Promise.resolve(exitCode),
    kill: () => {},
  })
}

describe("runDelegate", () => {
  it("collects final text from parsed lines", async () => {
    const result = await runDelegate({
      binary: "codex",
      args: [],
      parser: "codex",
      onProgress: () => {},
      spawn: fakeSpawn(['{"type":"item.completed","item":{"type":"agent_message","text":"PONG"}}']),
    })
    expect(result.finalText).toBe("PONG")
  })

  it("passes cwd through to spawn options", async () => {
    let received: SpawnOptions | undefined
    const spawn: SpawnFn = (_binary, _args, options) => {
      received = options
      return {
        stdout: new Response("").body!,
        stderr: new Response("").body!,
        exited: Promise.resolve(0),
        kill: () => {},
      }
    }
    await runDelegate({
      binary: "claude",
      args: [],
      parser: "raw",
      onProgress: () => {},
      spawn,
      cwd: "/tmp/some-dir",
    })
    expect(received?.cwd).toBe("/tmp/some-dir")
  })

  it("omits spawn options when no cwd given", async () => {
    let received: SpawnOptions | undefined | "unset"
    received = "unset"
    const spawn: SpawnFn = (_binary, _args, options) => {
      received = options
      return {
        stdout: new Response("").body!,
        stderr: new Response("").body!,
        exited: Promise.resolve(0),
        kill: () => {},
      }
    }
    await runDelegate({ binary: "claude", args: [], parser: "raw", onProgress: () => {}, spawn })
    expect(received).toBeUndefined()
  })

  it("kills the subprocess and rejects on timeout", async () => {
    let killed = false
    const spawn: SpawnFn = () => {
      let resolveExited!: (code: number) => void
      const exited = new Promise<number>((resolve) => {
        resolveExited = resolve
      })
      return {
        stdout: new Response("").body!,
        stderr: new Response("").body!,
        exited,
        kill: () => {
          killed = true
          resolveExited(143)
        },
      }
    }
    await expect(
      runDelegate({
        binary: "claude",
        args: [],
        parser: "raw",
        onProgress: () => {},
        spawn,
        timeoutMs: 50,
      }),
    ).rejects.toThrow(/timed out after 50ms/)
    expect(killed).toBe(true)
  })

  it("does not time out when the process exits in time", async () => {
    const result = await runDelegate({
      binary: "claude",
      args: [],
      parser: "raw",
      onProgress: () => {},
      spawn: fakeSpawn(["done"]),
      timeoutMs: 5000,
    })
    expect(result.finalText).toBe("done")
  })
})
