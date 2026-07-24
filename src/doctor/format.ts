import type { CheckResult } from "./checks"

export function formatResults(results: CheckResult[]): string {
  const lines: string[] = []
  for (const r of results) {
    lines.push(`${r.ok ? "✓" : "✗"} ${r.label} (${r.id}): ${r.detail}`)
    if (!r.ok && r.fixHint) {
      lines.push(`  → fix: ${r.fixHint}`)
    }
  }
  const failed = results.some((r) => !r.ok)
  if (!failed) {
    lines.push("", "All checks passed. Run `/claude hello` (or `/cc hello`) in opencode to verify end-to-end.")
  }
  return lines.join("\n")
}
