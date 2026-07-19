import type { ParsedLine } from "./parse-events"

export type SpawnFn = (
  binary: string,
  args: string[],
) => {
  stdout: ReadableStream<Uint8Array>
  stderr: ReadableStream<Uint8Array>
  exited: Promise<number>
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

export const defaultSpawn: SpawnFn = (binary, args) => {
  const proc = Bun.spawn([binary, ...args], { stdout: "pipe", stderr: "pipe" })
  return { stdout: proc.stdout, stderr: proc.stderr, exited: proc.exited }
}

export async function runDelegate(options: {
  binary: string
  args: string[]
  parseLine: (line: string) => ParsedLine
  onProgress: (text: string) => void
  spawn?: SpawnFn
}): Promise<RunDelegateResult> {
  const spawn = options.spawn ?? defaultSpawn
  const child = spawn(options.binary, options.args)

  let finalText = ""
  let externalId: string | undefined
  let stderrText = ""

  const stdoutTask = (async () => {
    for await (const line of readLines(child.stdout)) {
      if (!line.trim()) continue
      const parsed = options.parseLine(line)
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
  await Promise.all([stdoutTask, stderrTask])

  if (exitCode !== 0 && !finalText) {
    throw new Error(`${options.binary} exited with code ${exitCode}: ${stderrText.slice(0, 2000)}`)
  }

  return { finalText, externalId, stderrText }
}
