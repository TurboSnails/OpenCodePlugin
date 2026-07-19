import { test, expect } from "bun:test"
import { buildRoutingRule } from "./routing-rule"

test("names the delegate and its reply tool", () => {
  const rule = buildRoutingRule("claude")
  expect(rule).toContain("claude CLI")
  expect(rule).toContain("claude_reply")
})

test("works for codex", () => {
  const rule = buildRoutingRule("codex")
  expect(rule).toContain("codex CLI")
  expect(rule).toContain("codex_reply")
})

test("instructs verbatim forwarding without commentary", () => {
  const rule = buildRoutingRule("claude")
  expect(rule).toContain("verbatim")
  expect(rule).toContain("without adding your own commentary")
})

test("exempts delegate-switch commands from verbatim forwarding", () => {
  const rule = buildRoutingRule("codex")
  expect(rule).toContain("/cc")
  expect(rule).toContain("/codex")
  expect(rule.toLowerCase()).toContain("follow that command")
})

test("switch exemption holds for claude delegation too", () => {
  const rule = buildRoutingRule("claude")
  expect(rule).toContain("/cc")
  expect(rule).toContain("/codex")
})
