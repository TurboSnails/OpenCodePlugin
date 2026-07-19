// .opencode/lib/cli-dispatch/run-delegate.test.ts
import { test, expect } from "bun:test"
import { runDelegate, type SpawnFn } from "./run-delegate"
import { parseCodexLine } from "./parse-events"

function fakeSpawn(stdoutLines: string[], stderrLines: string[] = [], exitCode = 0): SpawnFn {
  return () => ({
    stdout: new Response(stdoutLines.map((l) => l + "\n").join("")).body!,
    stderr: new Response(stderrLines.map((l) => l + "\n").join("")).body!,
    exited: Promise.resolve(exitCode),
  })
}

test("collects final text and external id from streamed lines, forwards progress", async () => {
  const lines = [
    '{"type":"thread.started","thread_id":"thread-abc"}',
    '{"type":"turn.started"}',
    '{"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"PONG"}}',
    '{"type":"turn.completed","usage":{}}',
  ]
  const progressUpdates: string[] = []
  const result = await runDelegate({
    binary: "codex",
    args: [],
    parseLine: parseCodexLine,
    onProgress: (text) => progressUpdates.push(text),
    spawn: fakeSpawn(lines),
  })
  expect(result.finalText).toBe("PONG")
  expect(result.externalId).toBe("thread-abc")
  expect(progressUpdates).toContain("PONG")
})

test("keeps the last finalText when multiple agent_message events are seen", async () => {
  const lines = [
    '{"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"interim"}}',
    '{"type":"item.completed","item":{"id":"item_1","type":"agent_message","text":"final"}}',
  ]
  const result = await runDelegate({
    binary: "codex",
    args: [],
    parseLine: parseCodexLine,
    onProgress: () => {},
    spawn: fakeSpawn(lines),
  })
  expect(result.finalText).toBe("final")
})

test("captures stderr text alongside stdout", async () => {
  const result = await runDelegate({
    binary: "codex",
    args: [],
    parseLine: parseCodexLine,
    onProgress: () => {},
    spawn: fakeSpawn(['{"type":"turn.started"}'], ["some warning on stderr"]),
  })
  expect(result.stderrText).toContain("some warning on stderr")
})

test("throws with stderr content when process exits non-zero and produced no text", async () => {
  await expect(
    runDelegate({
      binary: "codex",
      args: [],
      parseLine: parseCodexLine,
      onProgress: () => {},
      spawn: fakeSpawn([], ["error: not logged in"], 1),
    }),
  ).rejects.toThrow(/not logged in/)
})

test("does not throw on non-zero exit if final text was already produced", async () => {
  const result = await runDelegate({
    binary: "codex",
    args: [],
    parseLine: parseCodexLine,
    onProgress: () => {},
    spawn: fakeSpawn(
      ['{"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"PONG"}}'],
      [],
      1,
    ),
  })
  expect(result.finalText).toBe("PONG")
})
