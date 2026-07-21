import { readFileSync, existsSync } from "fs"

export function getCurrentModel(transcriptPath: string): string | undefined {
  if (!existsSync(transcriptPath)) return undefined

  const lines = readFileSync(transcriptPath, "utf-8").split("\n")
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim()
    if (!line) continue

    let obj: unknown
    try {
      obj = JSON.parse(line)
    } catch {
      continue
    }

    if (typeof obj !== "object" || obj === null) continue
    const record = obj as Record<string, unknown>
    if (record.type !== "assistant") continue

    const message = record.message as Record<string, unknown> | undefined
    if (message && typeof message.model === "string") return message.model
  }

  return undefined
}
