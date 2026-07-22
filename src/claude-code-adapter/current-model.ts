import { readFileSync } from "fs"

// Neither Claude Code hook payload names the current model; the transcript
// JSONL records `message.model` on each assistant turn (design.md D7). The
// last such value is the conversation's current model. Returns undefined when
// the file is missing/unreadable or no assistant turn has a model yet (a
// session's first message) — callers fail open in that case.
export function getCurrentModel(transcriptPath: string): string | undefined {
  let raw: string
  try {
    raw = readFileSync(transcriptPath, "utf-8")
  } catch {
    return undefined
  }

  let model: string | undefined
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue
    let obj: unknown
    try {
      obj = JSON.parse(line)
    } catch {
      continue
    }
    if (typeof obj !== "object" || obj === null) continue
    const candidate = (obj as Record<string, any>).message?.model
    if (typeof candidate === "string" && candidate) model = candidate
  }
  return model
}
