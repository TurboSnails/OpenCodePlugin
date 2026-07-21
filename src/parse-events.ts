import type { ParserName } from "./config"

export type ParsedLine = {
  progressText?: string
  finalText?: string
  externalId?: string
  // When true, finalText is a chunk to append (newline-joined) instead of
  // replacing the text accumulated so far. Used by the raw parser, where
  // every stdout line is part of the final text.
  appendFinalText?: boolean
}

export type LineParser = (line: string) => ParsedLine

function isEventObject(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function parseClaudeLine(line: string): ParsedLine {
  let obj: unknown
  try {
    obj = JSON.parse(line)
  } catch {
    return { progressText: line }
  }

  if (!isEventObject(obj)) return {}

  if (obj.type === "assistant") {
    const text = (obj.message?.content ?? [])
      .filter((c: any) => c.type === "text")
      .map((c: any) => c.text)
      .join("")
    return text ? { progressText: text } : {}
  }

  if (obj.type === "result") {
    return { finalText: obj.result }
  }

  return {}
}

function parseCodexLine(line: string): ParsedLine {
  let obj: unknown
  try {
    obj = JSON.parse(line)
  } catch {
    return { progressText: line }
  }

  if (!isEventObject(obj)) return {}

  if (obj.type === "thread.started") {
    return { externalId: obj.thread_id }
  }

  if (obj.type === "item.started" && obj.item?.type === "command_execution") {
    return { progressText: `running: ${obj.item.command}` }
  }

  if (obj.type === "item.completed" && obj.item?.type === "command_execution") {
    return { progressText: `finished: ${obj.item.command}` }
  }

  if (obj.type === "item.completed" && obj.item?.type === "agent_message") {
    return { finalText: obj.item.text, progressText: obj.item.text }
  }

  return {}
}

function parseOpencodeLine(line: string): ParsedLine {
  let obj: unknown
  try {
    obj = JSON.parse(line)
  } catch {
    return { progressText: line }
  }

  if (!isEventObject(obj)) return {}

  const externalId = typeof obj.sessionID === "string" ? obj.sessionID : undefined

  if (obj.type === "text" && typeof obj.part?.text === "string") {
    return { externalId, progressText: obj.part.text, finalText: obj.part.text, appendFinalText: true }
  }

  return externalId ? { externalId } : {}
}

function parseRawLine(line: string): ParsedLine {
  return { progressText: line, finalText: line, appendFinalText: true }
}

const PARSERS: Record<ParserName, LineParser> = {
  claude: parseClaudeLine,
  codex: parseCodexLine,
  opencode: parseOpencodeLine,
  raw: parseRawLine,
}

export function getParser(name: ParserName): LineParser {
  return PARSERS[name] ?? PARSERS.raw
}
