const SUMMARY_LINE_CAP = 50

export function snapshotWorktree(cwd: string): string | null {
  try {
    const result = Bun.spawnSync(["git", "status", "--porcelain"], { cwd })
    if (!result.success) return null
    return result.stdout.toString()
  } catch {
    return null
  }
}

export function buildChangeSummary(before: string, after: string, cwd: string): string | null {
  if (before === after) return null

  let stat = ""
  try {
    const result = Bun.spawnSync(["git", "diff", "--stat"], { cwd })
    if (result.success) stat = result.stdout.toString().trimEnd()
  } catch {}

  const beforeUntracked = new Set(
    before.split("\n").filter((l) => l.startsWith("?? ")).map((l) => l.slice(3)),
  )
  const newFiles = after
    .split("\n")
    .filter((l) => l.startsWith("?? "))
    .map((l) => l.slice(3))
    .filter((f) => !beforeUntracked.has(f))

  const lines: string[] = []
  if (stat) lines.push(...stat.split("\n"))
  for (const f of newFiles) lines.push(`new file: ${f}`)

  if (lines.length === 0) return null

  let truncated = false
  if (lines.length > SUMMARY_LINE_CAP) {
    lines.length = SUMMARY_LINE_CAP
    truncated = true
  }
  const body = lines.join("\n") + (truncated ? "\n... (truncated)" : "")
  return `\n\n---\nChanged during this run:\n${body}`
}
