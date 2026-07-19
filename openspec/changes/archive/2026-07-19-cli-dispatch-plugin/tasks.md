## 1. Probe actual CLI streaming behavior

- [x] 1.1 Run `claude -p --output-format stream-json --session-id <uuid> "<trivial prompt>"` against a real Claude Code login and capture the actual JSONL event shapes emitted
- [x] 1.2 Run `claude -p --output-format stream-json --resume <uuid> "<follow-up prompt>"` and confirm the session continues (same conversation context as the first call)
- [x] 1.3 Run `codex exec --json "<trivial prompt>"` (headless, not via `mcp-server`) and confirm the JSONL shape matches expectations from the earlier `codex mcp-server` probe; run `codex exec resume <id> "<follow-up>"` and confirm continuation
- [x] 1.4 Document any auth/permission prompts each CLI raises in headless mode (e.g. codex `--sandbox`/`--approval-policy`, claude `--permission-mode`) and decide the default flags the plugin will pass so calls don't hang waiting for interactive approval

## 2. Plugin scaffold

- [x] 2.1 Create `.opencode/plugin/cli-dispatch.ts` in the project root: default-export an async `Plugin` function `(input) => Promise<Hooks>` that returns `{ tool: { <name>: ToolDefinition, ... } }`, using the `@opencode-ai/plugin` `tool()` helper to build each `ToolDefinition` (verified live: a plugin whose module only has a named export, e.g. `export const Foo = tool(...)`, fails to load with `"Plugin export is not a function"`; tools must be registered via the `tool` map on the returned `Hooks` object)
- [x] 2.2 Add an in-memory `Map<opencodeSessionID, { delegate: "codex"|"claude", threadId: string }>` inside the plugin module scope to track active delegation per opencode session
- [x] 2.3 Verify the plugin is auto-discovered by running `opencode debug config` in this project and confirming it appears under `plugin`/`plugin_origins` with `scope: "local"`

## 3. Codex delegate tools

- [x] 3.1 Implement `codex_start` tool: spawns `codex exec --json <flags> "<prompt>"`, parses JSONL events, calls `context.metadata()` with progress as events arrive, stores the returned thread id in the session map, returns the final agent message as the tool result
- [x] 3.2 Implement `codex_reply` tool: spawns `codex exec resume <threadId> --json "<prompt>"` using the thread id from the session map, same parsing/metadata/result handling as 3.1
- [x] 3.3 Handle the codex subprocess failing to start (binary missing, not logged in) with a clear error surfaced as the tool result rather than an uncaught exception

## 4. Claude delegate tools

- [x] 4.1 Implement `claude_start` tool: spawns `claude -p --output-format stream-json --session-id <generated-uuid> "<prompt>"`, parses stream-json events per task 1.1's findings, reports progress via `context.metadata()`, stores the session id, returns the final result
- [x] 4.2 Implement `claude_reply` tool: spawns `claude -p --output-format stream-json --resume <session-id> "<prompt>"`, same handling as 4.1
- [x] 4.3 Handle the claude subprocess failing to start (binary missing, not logged in) with a clear error surfaced as the tool result

## 5. Command routing

- [x] 5.1 Create `.opencode/command/codex.md`: prompt template instructing the model to call `codex_start` (no active codex thread for this session) or `codex_reply` (active thread exists) with the user's message, and to keep calling `codex_reply` for follow-up messages until another delegate command is used
- [x] 5.2 Create `.opencode/command/cc.md` with the equivalent instructions for `claude_start`/`claude_reply`
- [x] 5.3 Word each command's sticky-delegation instruction unambiguously (per design.md Risk on model-mediated routing), e.g. explicitly stating "for every message after this one, call `<delegate>_reply` instead of answering directly, until the user runs `/codex` or `/cc` again"

## 6. Manual verification

- [ ] 6.1 In a real opencode session, run `/codex do X`, confirm codex's response appears and progress was visible while it ran
- [ ] 6.2 Send a follow-up message without a command prefix, confirm it continued the same codex thread (response reflects context from the first message)
- [ ] 6.3 Run `/cc do Y` mid-conversation, confirm claude takes over and subsequent un-prefixed messages route to claude, not codex
- [ ] 6.4 Open two separate opencode sessions, delegate both to codex, confirm their threads stay independent (per the "Session state scoped per opencode session" requirement)
