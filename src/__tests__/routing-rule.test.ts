import { describe, it, expect } from "bun:test"
import { buildRoutingRule } from "../routing-rule"

describe("buildRoutingRule", () => {
  it("includes delegate name in routing rule", () => {
    const rule = buildRoutingRule("claude")
    expect(rule).toContain("claude")
  })

  it("includes delegation active message", () => {
    const rule = buildRoutingRule("codex")
    expect(rule).toContain("DELEGATION ACTIVE")
  })

  it("includes reply tool reference", () => {
    const rule = buildRoutingRule("myagent")
    expect(rule).toContain("myagent_reply")
  })

  it("works with any delegate name", () => {
    const rule = buildRoutingRule("custom-cli")
    expect(rule).toContain("custom-cli")
    expect(rule).toContain("custom-cli_reply")
  })

  it("uses a custom reply tool name when provided", () => {
    const rule = buildRoutingRule("codex", "mcp__cli-dispatch__codex_reply")
    expect(rule).toContain("mcp__cli-dispatch__codex_reply")
    expect(rule).not.toContain("to the codex_reply tool.")
  })

  it("defaults the reply tool name to `${delegate}_reply` when not provided", () => {
    const rule = buildRoutingRule("codex")
    expect(rule).toContain("codex_reply")
  })
})
