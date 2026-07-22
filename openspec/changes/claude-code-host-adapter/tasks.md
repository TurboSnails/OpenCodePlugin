## 1. Resolve open decisions before implementation

- [x] 1.1 Confirmed with the user: the home command is `/cc` (consistent with this repo's existing `.opencode/command/cc.md` alias convention).
- [x] 1.2 Live spike (2026-07-21, `@modelcontextprotocol/sdk` throwaway MCP server + `claude -p --mcp-config ... --strict-mcp-config`): confirmed `PreToolUse` fires for MCP-registered tools (`tool_name: "mcp__<server>__<tool>"`) and exit code 2 fully blocks the call before the tool handler runs (verified via the handler's own log file never being created). Recorded in design.md D3.
- [x] 1.3 Live spike (2026-07-21): confirmed `UserPromptSubmit` exit 0 injects stdout as additive context that a well-behaved model acts on for legitimately-worded routing text (adversarially-worded injected text is correctly refused — model self-defense, not a hook failure); confirmed exit 2 fully suppresses the prompt (`num_turns: 0`, zero token usage, no model call at all), a strictly stronger guarantee than OpenCode's mechanism. Recorded in design.md D4 — the `verifiedModels` gate is a true hard block, not a warning-only fallback.
- [x] 1.4 Based on 1.2/1.3, finalized session-state persistence as the file-backed store (design.md D5) — no remaining pressure toward MCP-mediated state, since neither hard-block path depends on the MCP server being reachable.
- [x] 1.5 Live spike: confirmed neither `PreToolUse` nor `UserPromptSubmit`'s payload names the current model. Found `transcript_path`'s JSONL file records `message.model` on each assistant turn; last such line is the substitute signal, fail-open when none exists yet (first message). Recorded in design.md D7 — `verifiedModels` for this adapter uses bare model-string patterns (not `provider/model` pairs), and the file-backed store no longer needs to persist a tracked model at all.
- [x] 1.6 Live spike: confirmed a real custom slash command's `UserPromptSubmit` payload carries the raw unexpanded text (e.g. `"/codex do the thing"`), not the expanded template body — command detection is simple prefix matching on `input.prompt`. Also confirmed MCP tool handlers don't receive Claude Code's session id via the MCP request (`extra.sessionId` is present but `undefined` for stdio transport), but the MCP server subprocess's own `CLAUDE_CODE_SESSION_ID` environment variable is identical to the hooks' `session_id` — this is what tool handlers use to key the file-backed store. Recorded in design.md D4/D8.

## 2. Shared core changes (OpenCode-agnostic, reused by this adapter)

- [x] 2.1 Add `"opencode"` to `ParserName` in `src/config.ts`, update `validateConfig`'s parser check, and extract the existing per-delegate validation loop into an exported `validateDelegates(delegates: Record<string, unknown>): string[]` function (called by `validateConfig` unchanged in behavior) so the Claude Code adapter's own config loader (task 3) can reuse it instead of duplicating delegate validation.
- [x] 2.2 Add `parseOpencodeLine` to `src/parse-events.ts`: extract `externalId` from `obj.sessionID` (present on every line) and accumulate `finalText` from `type: "text"` events' `part.text`, following the `raw` parser's `appendFinalText` pattern. Register it in `PARSERS`.
- [x] 2.3 Add an optional second parameter to `buildRoutingRule` in `src/routing-rule.ts` (`replyTool?: string`, defaulting to `` `${delegate}_reply` ``) so the Claude Code adapter can pass the MCP-namespaced tool name (`` mcp__cli-dispatch__${name}_reply ``) while OpenCode's existing single-argument call sites are unaffected.
- [x] 2.4 Unit tests: `parseOpencodeLine` (session id extraction, single/multiple `text` events accumulating in order, malformed lines, unrelated event types); `validateDelegates` (moved, behavior-preserving — existing `config.test.ts` cases must still pass unchanged); `buildRoutingRule`'s new second parameter (existing single-arg tests unaffected, new test for the override).

## 3. Claude Code adapter: config, model discovery, session store

- [x] 3.1 `src/claude-code-adapter/config.ts`: `ClaudeCodeAdapterConfig` type (`delegates: Record<string, DelegateConfig>`, `verifiedModels?: string[]`), `isValidModelPattern`/`matchesModelPattern` (bare model-string, trailing-`*` wildcard, case-sensitive), `loadAdapterConfig(configPath?): ClaudeCodeAdapterConfig` reusing `validateDelegates` from task 2.1.
- [x] 3.2 `src/claude-code-adapter/current-model.ts`: `getCurrentModel(transcriptPath: string): string | undefined`, reading the JSONL file and returning the last `message.model` value found (undefined if the file doesn't exist or no assistant line has one yet).
- [x] 3.3 `src/claude-code-adapter/session-store.ts`: file-backed `getActiveDelegate`/`setActiveDelegate`/`clearActiveDelegate`, keyed by Claude Code session id, atomic write-temp-then-rename.
- [x] 3.4 Unit tests for all three modules.

## 4. Hooks: sanitization and routing logic (pure, testable)

- [x] 4.1 `src/claude-code-adapter/pretooluse-check.ts`: `checkPreToolUse(input): {block: false} | {block: true; reason: string}`, rejecting a `prompt` argument containing `GENERATED_MARKER` for the four MCP-namespaced delegate tool names.
- [x] 4.2 `src/claude-code-adapter/userpromptsubmit-logic.ts`: `decideUserPromptSubmit(input, config): {kind: "none"} | {kind: "inject"; context: string} | {kind: "block"; reason: string}` — home command (`/cc`) clears state and blocks with a note; delegate-start commands (`/codex`, `/opencode`) apply the `verifiedModels` gate (fail open if model unknown or no active gate) and otherwise pass through unblocked; an active delegation with no recognized command prefix injects the routing rule.
- [x] 4.3 Thin CLI wrappers (`pretooluse-cli.ts`, `userpromptsubmit-cli.ts`): read stdin JSON, call the pure functions above, translate the verdict into stdout/stderr + exit code.
- [x] 4.4 Unit tests for both pure logic functions (block/inject/none branches, fail-open cases).

## 5. MCP server: delegate tools

- [x] 5.1 `src/claude-code-adapter/delegate-tools.ts`: `startDelegate`/`replyDelegate` business logic (mirrors `src/delegate-tools.ts`'s `makeStartTool`/`makeReplyTool`, reusing `runDelegate`, injectable `run` param for tests, no restrictive-agent check — that's an OpenCode-specific concept with no Claude Code equivalent).
- [x] 5.2 `src/claude-code-adapter/mcp-server.ts`: registers `codex_start`/`codex_reply`/`opencode_start`/`opencode_reply` via `@modelcontextprotocol/sdk`'s `McpServer`/`StdioServerTransport`, keying the session store by `process.env.CLAUDE_CODE_SESSION_ID`.
- [x] 5.3 Add `@modelcontextprotocol/sdk` and `zod` to `package.json` `dependencies` (real runtime deps for this adapter, unlike `@opencode-ai/plugin`'s peer/dev-only split).
- [x] 5.4 Unit tests for `startDelegate`/`replyDelegate` using a fake `run` function (mirrors `src/__tests__/delegate-tools.test.ts`'s pattern).

## 6. Wiring (dogfooding this repo)

- [x] 6.1 `claude-code-adapter.config.json` at repo root: `codex`/`opencode` delegates + `verifiedModels`.
- [x] 6.2 `.mcp.json` at repo root: register the `cli-dispatch` MCP server.
- [x] 6.3 Merge `PreToolUse`/`UserPromptSubmit` hooks into the existing `.claude/settings.json` (preserve the existing `permissions` block).
- [x] 6.4 `.claude/commands/codex.md`, `.claude/commands/opencode.md`, `.claude/commands/cc.md`.
- [x] 6.5 Document the one-time `.mcp.json` approval step end users hit (design.md risk) in README.md/README_CN.md, plus the adapter's configuration, cross-referencing the OpenCode section rather than duplicating it.

## 7. End-to-end verification

- [ ] 7.1 Live test: start a codex delegation via `/codex`, send a sticky follow-up, confirm it continues the same codex session.
- [ ] 7.2 Live test: start an opencode delegation via `/opencode`, confirm the `"opencode"` parser correctly extracts progress/final text and session id from real `opencode run --format json` output.
- [ ] 7.3 Live test: configure `verifiedModels` to exclude the current model, confirm the delegate-start command is blocked before any tool call.
- [ ] 7.4 Live test: issue `/cc`, confirm delegation state is cleared and Claude Code answers directly again with no model turn wasted on relaying the message.
- [ ] 7.5 Run the existing `bun test` suite to confirm no regression to the OpenCode adapter or shared core modules.
