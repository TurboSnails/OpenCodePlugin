export type ParsedLine = {
  progressText?: string
  finalText?: string
  externalId?: string
}

export function parseCodexLine(line: string): ParsedLine {
  let obj: any
  try {
    obj = JSON.parse(line)
  } catch {
    return { progressText: line }
  }

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

export function parseClaudeLine(line: string): ParsedLine {
  let obj: any
  try {
    obj = JSON.parse(line)
  } catch {
    return { progressText: line }
  }

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

export function parseKimiLine(line: string): ParsedLine {
  let obj: any
  try {
    obj = JSON.parse(line)
  } catch {
    return { progressText: line }
  }

  if (obj.role === "assistant" && Array.isArray(obj.content)) {
    const text = obj.content
      .filter((c: any) => c.type === "text")
      .map((c: any) => c.text)
      .join("")
    const think = obj.content
      .filter((c: any) => c.type === "think")
      .map((c: any) => c.think)
      .join("")
    return {
      finalText: text || undefined,
      progressText: text || think || undefined,
    }
  }
  return {}
}

const KIMI_RESUME_HINT = /To resume this session: kimi -r ([0-9a-fA-F-]+)/

export function parseKimiStderrForSessionId(stderrText: string): string | undefined {
  return KIMI_RESUME_HINT.exec(stderrText)?.[1]
}
