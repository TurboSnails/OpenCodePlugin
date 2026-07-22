import { describe, it, expect } from "bun:test"
import { mkdtempSync, rmSync, existsSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"
import { runDelegate, MAX_STDOUT_CHARS, MAX_LINE_CHARS, type SpawnFn, type SpawnOptions } from "../run-delegate"

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

  it("concatenates all raw stdout lines as the final text", async () => {
    const result = await runDelegate({
      binary: "my-agent",
      args: [],
      parser: "raw",
      onProgress: () => {},
      spawn: fakeSpawn(["line one", "line two", "line three"]),
    })
    expect(result.finalText).toBe("line one\nline two\nline three")
  })

  it("keeps the last agent_message as the final text for the codex parser", async () => {
    const result = await runDelegate({
      binary: "codex",
      args: [],
      parser: "codex",
      onProgress: () => {},
      spawn: fakeSpawn([
        '{"type":"item.completed","item":{"type":"agent_message","text":"first draft"}}',
        '{"type":"item.completed","item":{"type":"agent_message","text":"final answer"}}',
      ]),
    })
    expect(result.finalText).toBe("final answer")
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

  it("escalates to SIGKILL when the process ignores SIGTERM after a timeout", async () => {
    const signals: (string | undefined)[] = []
    let resolveExited!: (code: number) => void
    const spawn: SpawnFn = () => ({
      stdout: new Response("").body!,
      stderr: new Response("").body!,
      exited: new Promise<number>((resolve) => {
        resolveExited = resolve
      }),
      kill: (signal?: string) => {
        signals.push(signal)
        if (signal === "SIGKILL") resolveExited(137)
      },
    })
    // Safety net so this test fails fast instead of hanging if the
    // SIGTERM->SIGKILL escalation is missing: force the fake process to
    // exit, which makes the assertions below fail instead.
    const watchdog = setTimeout(() => resolveExited(143), 300)
    await expect(
      runDelegate({
        binary: "claude",
        args: [],
        parser: "raw",
        onProgress: () => {},
        spawn,
        timeoutMs: 50,
        killGraceMs: 50,
      }),
    ).rejects.toThrow(/timed out after 50ms/)
    clearTimeout(watchdog)
    expect(signals).toEqual(["SIGTERM", "SIGKILL"])
  })

  it("kills the subprocess and rejects as cancelled when the abort signal fires", async () => {
    const controller = new AbortController()
    const signals: (string | undefined)[] = []
    let resolveExited!: (code: number) => void
    const spawn: SpawnFn = () => ({
      stdout: new Response("").body!,
      stderr: new Response("").body!,
      exited: new Promise<number>((resolve) => {
        resolveExited = resolve
      }),
      kill: (signal?: string) => {
        signals.push(signal)
        resolveExited(143)
      },
    })
    // Safety net so this test fails fast instead of hanging if the abort
    // signal is not wired up.
    const watchdog = setTimeout(() => resolveExited(0), 300)
    const run = runDelegate({
      binary: "claude",
      args: [],
      parser: "raw",
      onProgress: () => {},
      spawn,
      signal: controller.signal,
    })
    controller.abort()
    await expect(run).rejects.toThrow(/cancelled by user/)
    clearTimeout(watchdog)
    expect(signals).toEqual(["SIGTERM"])
  })

  it("rejects as cancelled when the signal is already aborted before spawning", async () => {
    const controller = new AbortController()
    controller.abort()
    let killed = false
    let resolveExited!: (code: number) => void
    const spawn: SpawnFn = () => ({
      stdout: new Response("").body!,
      stderr: new Response("").body!,
      exited: new Promise<number>((resolve) => {
        resolveExited = resolve
      }),
      kill: () => {
        killed = true
        resolveExited(143)
      },
    })
    const watchdog = setTimeout(() => resolveExited(0), 300)
    await expect(
      runDelegate({
        binary: "claude",
        args: [],
        parser: "raw",
        onProgress: () => {},
        spawn,
        signal: controller.signal,
      }),
    ).rejects.toThrow(/cancelled by user/)
    clearTimeout(watchdog)
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

  it("reports a non-zero exit as failure even when final text was produced", async () => {
    await expect(
      runDelegate({
        binary: "codex",
        args: [],
        parser: "codex",
        onProgress: () => {},
        spawn: fakeSpawn(['{"type":"item.completed","item":{"type":"agent_message","text":"done"}}'], ["boom"], 1),
      }),
    ).rejects.toThrow("exited with code 1")
  })

  it("includes a capped stderr excerpt in the non-zero exit error", async () => {
    await expect(
      runDelegate({
        binary: "codex",
        args: [],
        parser: "codex",
        onProgress: () => {},
        spawn: fakeSpawn([], ["x".repeat(5000)], 3),
      }),
    ).rejects.toThrow(/^codex exited with code 3: x{1,2500}$/)
  })

  it("fails the run when stdout exceeds the cap", async () => {
    let resolveExit!: (code: number) => void
    const exited = new Promise<number>((r) => { resolveExit = r })
    const spawn: SpawnFn = () => ({
      stdout: new Response("x".repeat(MAX_STDOUT_CHARS + 1)).body!,
      stderr: new Response("").body!,
      exited,
      kill: () => resolveExit(1),
    })
    await expect(
      runDelegate({ binary: "fake", args: [], parser: "raw", onProgress: () => {}, spawn, killGraceMs: 10, drainGraceMs: 10 }),
    ).rejects.toThrow("produced too much output")
  })

  it("fails the run when a single output line exceeds the line cap", async () => {
    let resolveExit!: (code: number) => void
    const exited = new Promise<number>((r) => { resolveExit = r })
    const spawn: SpawnFn = () => ({
      stdout: new Response("x".repeat(MAX_LINE_CHARS + 1) + "\n").body!,
      stderr: new Response("").body!,
      exited,
      kill: () => resolveExit(1),
    })
    await expect(
      runDelegate({ binary: "fake", args: [], parser: "raw", onProgress: () => {}, spawn, killGraceMs: 10, drainGraceMs: 10 }),
    ).rejects.toThrow("produced too much output")
  })

  it("kills the process tree on timeout and does not wait for pipes held open by a grandchild", async () => {
    const killSignals: Array<string | undefined> = []
    let resolveExit!: (code: number) => void
    const exited = new Promise<number>((r) => { resolveExit = r })
    const spawn: SpawnFn = () => ({
      stdout: new ReadableStream({ start() {} }), // never emits, never ends
      stderr: new ReadableStream({ start() {} }),
      exited,
      kill: () => {},
      killTree: (signal) => {
        killSignals.push(signal)
        if (signal === "SIGKILL") resolveExit(9)
      },
    })
    await expect(
      runDelegate({ binary: "fake", args: [], parser: "raw", onProgress: () => {}, spawn, timeoutMs: 50, killGraceMs: 20, drainGraceMs: 20 }),
    ).rejects.toThrow("timed out")
    expect(killSignals).toEqual(["SIGTERM", "SIGKILL"])
  })

  it.skipIf(process.platform === "win32")("kills the whole process tree on timeout (real spawn)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cli-dispatch-tree-test-"))
    const marker = join(dir, "grandchild-alive")
    try {
      await expect(
        runDelegate({
          binary: "bun",
          args: ["-e", `Bun.spawn(["bun","-e","setTimeout(()=>Bun.write(\\"${marker}\\",'x'),400)"],{stdout:'inherit',stderr:'inherit'});await new Promise(r=>setTimeout(r,60000))`],
          parser: "raw",
          onProgress: () => {},
          timeoutMs: 300,
          killGraceMs: 100,
        }),
      ).rejects.toThrow("timed out")
      await Bun.sleep(800)
      expect(existsSync(marker)).toBe(false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
