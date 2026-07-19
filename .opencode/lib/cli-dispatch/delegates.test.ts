// .opencode/lib/cli-dispatch/delegates.test.ts
import { test, expect } from "bun:test"
import {
  buildCodexStartArgs,
  buildCodexReplyArgs,
  buildClaudeStartArgs,
  buildClaudeReplyArgs,
  buildKimiStartArgs,
  buildKimiReplyArgs,
} from "./delegates"

test("codex start args", () => {
  expect(buildCodexStartArgs("hi")).toEqual([
    "exec",
    "--json",
    "-c",
    "sandbox_mode=read-only",
    "--skip-git-repo-check",
    "--",
    "hi",
  ])
})

test("codex reply args", () => {
  expect(buildCodexReplyArgs("thread-1", "hi")).toEqual([
    "exec",
    "resume",
    "thread-1",
    "--json",
    "-c",
    "sandbox_mode=read-only",
    "--skip-git-repo-check",
    "--",
    "hi",
  ])
})

test("claude start args", () => {
  expect(buildClaudeStartArgs("uuid-1", "hi")).toEqual([
    "-p",
    "--output-format",
    "stream-json",
    "--verbose",
    "--permission-mode",
    "dontAsk",
    "--session-id",
    "uuid-1",
    "--",
    "hi",
  ])
})

test("claude reply args", () => {
  expect(buildClaudeReplyArgs("uuid-1", "hi")).toEqual([
    "-p",
    "--output-format",
    "stream-json",
    "--verbose",
    "--permission-mode",
    "dontAsk",
    "--resume",
    "uuid-1",
    "--",
    "hi",
  ])
})

test("kimi start args", () => {
  expect(buildKimiStartArgs("hi")).toEqual(["--print", "--output-format", "stream-json", "--prompt", "hi"])
})

test("kimi reply args", () => {
  expect(buildKimiReplyArgs("sess-1", "hi")).toEqual([
    "--print",
    "--output-format",
    "stream-json",
    "-r",
    "sess-1",
    "--prompt",
    "hi",
  ])
})
