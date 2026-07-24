import { describe, it, expect } from "bun:test"
import { formatResults } from "../doctor/format"
import type { CheckResult } from "../doctor/checks"

describe("formatResults", () => {
  it("marks a passing check with a checkmark", () => {
    const results: CheckResult[] = [{ id: "a", label: "A check", ok: true, detail: "all good" }]
    expect(formatResults(results)).toContain("✓ A check (a): all good")
  })

  it("marks a failing check with an x", () => {
    const results: CheckResult[] = [{ id: "a", label: "A check", ok: false, detail: "broke" }]
    expect(formatResults(results)).toContain("✗ A check (a): broke")
  })

  it("includes a fix hint line under a failing check", () => {
    const results: CheckResult[] = [{ id: "a", label: "A check", ok: false, detail: "broke", fixHint: "do X" }]
    const output = formatResults(results)
    expect(output).toContain("✗ A check (a): broke")
    expect(output).toContain("  → fix: do X")
  })

  it("omits the fix hint line when a check passes", () => {
    const results: CheckResult[] = [{ id: "a", label: "A check", ok: true, detail: "fine", fixHint: "unused" }]
    expect(formatResults(results)).not.toContain("→ fix:")
  })

  it("appends the all-clear trailer when every check passes", () => {
    const results: CheckResult[] = [{ id: "a", label: "A", ok: true, detail: "ok" }]
    expect(formatResults(results)).toContain("All checks passed.")
  })

  it("omits the all-clear trailer when any check fails", () => {
    const results: CheckResult[] = [
      { id: "a", label: "A", ok: true, detail: "ok" },
      { id: "b", label: "B", ok: false, detail: "bad" },
    ]
    expect(formatResults(results)).not.toContain("All checks passed.")
  })

  it("joins multiple results in order, one per line", () => {
    const results: CheckResult[] = [
      { id: "a", label: "A", ok: true, detail: "1" },
      { id: "b", label: "B", ok: true, detail: "2" },
    ]
    const lines = formatResults(results).split("\n")
    expect(lines[0]).toContain("A")
    expect(lines[1]).toContain("B")
  })
})
