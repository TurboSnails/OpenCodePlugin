import type { ParserName } from "./config"
import { getParser } from "./parse-events"

export type SpawnOptions = {
  cwd?: string
}

export type SpawnFn = (
  binary: string,
  args: string[],
  options?: SpawnOptions,
) => {
  stdout: ReadableStream<Uint8Array>
  stderr: ReadableStream<Uint8Array>
  exited: Promise<number>
  kill: (signal?: "SIGTERM" | "SIGKILL") => void
}

export type RunDelegateResult = {
  finalText: string
  externalId?: string
  stderrText: string
}

async function* readLines(stream: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let newlineIndex: number
      while ((newlineIndex = buffer.indexOf("\n")) >= 0) {
        yield buffer.slice(0, newlineIndex)
        buffer = buffer.slice(newlineIndex + 1)
      }
    }
    if (buffer.length > 0) yield buffer
  } finally {
    reader.releaseLock()
  }
}

export const defaultSpawn: SpawnFn = (binary, args, options) => {
  const proc = Bun.spawn([binary, ...args], {
    stdout: "pipe",
    stderr: "pipe",
    ...(options?.cwd ? { cwd: options.cwd } : {}),
  })
  return { stdout: proc.stdout, stderr: proc.stderr, exited: proc.exited, kill: (signal) => proc.kill(signal) }
}

// Grace period between SIGTERM and SIGKILL when terminating a hung delegate.
export const KILL_GRACE_MS = 2000

export async function runDelegate(options: {
  binary: string
  args: string[]
  parser: ParserName
  onProgress: (text: string) => void
  spawn?: SpawnFn
  cwd?: string
  timeoutMs?: number
  killGraceMs?: number
  signal?: AbortSignal
}): Promise<RunDelegateResult> {
  const spawn = options.spawn ?? defaultSpawn
  const child = spawn(options.binary, options.args, options.cwd ? { cwd: options.cwd } : undefined)
  const parseLine = getParser(options.parser)

  let finalText = ""
  let externalId: string | undefined
  let stderrText = ""
  let timedOut = false
  let cancelled = false

  let killTimer: ReturnType<typeof setTimeout> | undefined
  const terminateChild = () => {
    child.kill("SIGTERM")
    killTimer = setTimeout(() => child.kill("SIGKILL"), options.killGraceMs ?? KILL_GRACE_MS)
  }

  const onAbort = () => {
    cancelled = true
    terminateChild()
  }
  if (options.signal) {
    if (options.signal.aborted) onAbort()
    else options.signal.addEventListener("abort", onAbort, { once: true })
  }

  const timer = options.timeoutMs
    ? setTimeout(() => {
        timedOut = true
        terminateChild()
      }, options.timeoutMs)
    : undefined

  const stdoutTask = (async () => {
    for await (const line of readLines(child.stdout)) {
      if (!line.trim()) continue
      const parsed = parseLine(line)
      if (parsed.externalId) externalId = parsed.externalId
      if (parsed.finalText !== undefined) finalText = parsed.finalText
      if (parsed.progressText) options.onProgress(parsed.progressText)
    }
  })()

  const stderrTask = (async () => {
    for await (const line of readLines(child.stderr)) {
      stderrText += line + "\n"
    }
  })()

  const exitCode = await child.exited
  if (timer) clearTimeout(timer)
  if (killTimer) clearTimeout(killTimer)
  options.signal?.removeEventListener("abort", onAbort)
  await Promise.all([stdoutTask, stderrTask])

  if (cancelled) {
    throw new Error(`${options.binary} cancelled by user`)
  }

  if (timedOut) {
    throw new Error(`${options.binary} timed out after ${options.timeoutMs}ms`)
  }

  if (exitCode !== 0 && !finalText) {
    throw new Error(`${options.binary} exited with code ${exitCode}: ${stderrText.slice(0, 2000)}`)
  }

  return { finalText, externalId, stderrText }
}
