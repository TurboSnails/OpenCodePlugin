# CLI Dispatch Plugin — Design

## Context

The user drives day-to-day work from opencode but also has `codex`, `claude` (Claude Code), and `kimi` installed and authenticated locally, each with its own agent loop, context management, and tool execution. The goal is to delegate an opencode conversation to any of those three CLIs' own agent loops — reusing their existing local authentication and session/context management — rather than reimplementing their logic or calling the underlying model APIs directly with separate keys.

Facts verified locally before finalizing this design (see full trail in `openspec/changes/cli-dispatch-plugin/design.md`):
- `codex mcp-server` is a real, working native MCP server (`codex`/`codex-reply` tools, `threadId` continuation) — confirmed via a raw JSON-RPC round trip that returned an actual `PONG` response using the user's authenticated codex account (rate-limit info in the response proved this), and via `opencode mcp list` showing `connected`.
- `claude mcp serve` exposes Claude Code's raw tool belt (`Bash`, `Read`, `Edit`, `Skill`, `Agent`, … 26 tools) rather than a single "run the task" tool — using it would make opencode's own model the planner, which defeats the goal of reusing Claude Code's own agent loop. Not used for that reason.
- All three CLIs support headless execution with structured streaming output and session resume: `codex exec --json` + `codex exec resume <id>`; `claude -p --output-format stream-json` + `--session-id`/`--resume`; `kimi --print --output-format stream-json` + `--session`/`--continue`.
- opencode's plugin SDK (`@opencode-ai/plugin`) exports a `tool()` helper with a `context.metadata()` callback for live progress, and auto-discovers project-local plugins from `.opencode/plugin/*.ts` — confirmed via `opencode debug config` showing the test plugin registered with `scope: "local"` with no manual config entry needed.
- This project already mirrors command/skill files per-CLI (`.opencode/command/`, `.codex/prompts/`, `.claude/commands/opsx/`, `.cursor/commands/` all carry the same openspec commands today; `android-cli` skill is manually mirrored into both `.codex/skills/` and `.claude/skills/`), establishing a working precedent for per-CLI file placement.

## Goals / Non-Goals

**Goals:**
- Delegate the current opencode conversation to codex, claude, or kimi's own CLI agent via `/codex`, `/cc`, `/kimi`, reusing each CLI's existing local auth and session/context management.
- Sticky multi-turn delegation: once a delegate is addressed, subsequent un-prefixed messages continue that delegate's session until a different `/codex`/`/cc`/`/kimi` command takes over.
- Live progress from the running delegate, surfaced inside opencode's own UI.

**Non-Goals:**
- No standalone MCP servers for claude/kimi, and no reliance on `claude mcp serve` or `codex mcp-server` for the delegation path itself — all three delegates go through one uniform headless-subprocess pattern instead.
- No mirroring of superpowers skills (e.g. `brainstorming`) into `~/.codex/skills` or a kimi skills directory in this change — that is separate, on-demand follow-up work, following the existing `android-cli` mirroring precedent.
- Not exposed as a standard MCP server for other clients (Claude Desktop, Cursor) to reuse — opencode-only.
- `~/ClaudeCodeKimi` / `~/.gemini-proxy` (an unrelated older project that swaps Claude Code's backing model for Kimi's API) are out of scope and not reused.

## Decisions

**1. opencode plugin `tool()` API instead of per-CLI MCP servers.**
Considered building three MCP servers (codex's native `mcp-server`, plus hand-written stdio wrappers for claude/kimi) registered through opencode's `mcp` config, versus a single opencode plugin using `tool()`. Chose the plugin because all three CLIs already support headless mode with streaming JSON and session resume — there's no capability gap that needs a custom server protocol to fill. One plugin gives one code path, an in-memory session map instead of managing long-running server processes, and native progress reporting via `context.metadata()`. The main advantage of the MCP route — other MCP clients could reuse the same servers — isn't needed since this is opencode-only.

**2. `codex exec --json`, not `codex mcp-server`, for consistency.**
`codex mcp-server` works and was verified end-to-end, and arguably gives codex a richer built-in event schema. Not used, so that all three delegates share the same implementation pattern (headless subprocess + JSONL stream + resume flag) instead of codex being special-cased through MCP while claude/kimi use a different mechanism.

**3. Sticky delegation is command-instruction-driven, not plugin-enforced.**
`/codex`, `/cc`, `/kimi` are plain opencode prompt-template commands (matching the existing `.opencode/command/opsx-*.md` convention) that instruct the model to call `*_start` on the first message and `*_reply` on follow-ups, using the stored thread/session id. opencode's plugin Hooks API has no "rewrite which tool handles the next message" hook, so this is model-mediated: the model, following the command's instructions each turn, chooses to keep calling `*_reply`. This is a soft mechanism, not a hard state machine — see Risks.

**4. Session state: in-memory `Map` keyed by opencode session ID.**
Each entry stores the active delegate and its thread/session id. Lost on opencode restart — acceptable because each delegate CLI persists its own session transcript on disk (`~/.codex/sessions/`, `~/.claude/projects/*/*.jsonl`, `~/.kimi/sessions/`) and can be resumed by hand if needed.

**5. Progress parses each CLI's own JSONL stream directly — no file tailing.**
Chosen over tailing session log files because it's simpler (no filesystem watching or active-session lookup) now that streaming JSON output on stdout is confirmed for all three CLIs.

## Architecture

```
opencode session
  │
  │  /codex, /cc, /kimi  → prompt-template commands (.opencode/command/*.md)
  │  instruct the model which tool to call and when to keep replying
  ▼
.opencode/plugin/cli-dispatch.ts  (opencode plugin, tool() API)
  │
  │  in-memory Map<opencodeSessionID, {delegate, threadId}>
  │
  ├─ codex_start / codex_reply  → spawn `codex exec --json [resume <id>]`
  ├─ claude_start / claude_reply → spawn `claude -p --output-format stream-json [--session-id|--resume <id>]`
  └─ kimi_start / kimi_reply     → spawn `kimi --print --output-format stream-json [--session|--continue <id>]`
        │
        │  parse JSONL as it arrives → context.metadata() (live progress in opencode UI)
        ▼
  final agent message → returned as the tool's result
```

## Components

- **`.opencode/plugin/cli-dispatch.ts`** — the plugin module. Registers six tools and owns the session map. One module keeps the three delegates' logic consistent; can be split into per-CLI files later if it grows unwieldy.
- **`.opencode/command/codex.md`, `cc.md`, `kimi.md`** — thin prompt templates, no logic of their own beyond instructing the model how to route. They are the only user-facing surface (`/codex`, `/cc`, `/kimi`).
- **Session map** — process-local state, not persisted. Keyed by opencode session ID; each value names the active delegate and that delegate's own thread/session id.

## Data Flow

1. User sends `/codex <task>` (or `/cc`, `/kimi`).
2. The command template tells the model: no active codex thread for this opencode session yet → call `codex_start` with the task text.
3. `codex_start` spawns `codex exec --json "<task>"`, streams JSONL lines, calls `context.metadata()` per event, and on completion stores `{delegate: "codex", threadId}` in the session map and returns the final agent message.
4. User sends a follow-up with no command prefix. The command template's standing instruction (still in context) tells the model to call `codex_reply` with the stored `threadId`.
5. `codex_reply` spawns `codex exec resume <threadId> --json "<message>"`, same streaming/metadata/result handling.
6. User sends `/cc <task>` mid-conversation. The `cc` command template tells the model to call `claude_start` (no active claude thread yet), overriding which delegate subsequent un-prefixed messages route to.

## Error Handling

- If a delegate binary is missing or not authenticated, the corresponding `*_start`/`*_reply` tool catches the spawn/exit failure and returns a clear error string as the tool result (visible to the user in-chat) instead of throwing an uncaught exception that would crash the turn.
- Headless flags are chosen so calls don't hang waiting on interactive approval prompts (e.g. codex's `--sandbox`/`--approval-policy`, claude's `--permission-mode`) — exact defaults to be finalized during implementation (task 1.6 in the OpenSpec tasks list) since they weren't fully probed for claude/kimi.
- Malformed or unrecognized JSONL lines from a delegate are treated as opaque text and appended to progress/output rather than aborting the call.

## Testing

- **Probe first, implement second:** before wiring up claude/kimi parsing, run each CLI's headless streaming command against a trivial prompt and capture real JSONL shapes (only `codex exec --json` has been round-trip tested so far; claude/kimi flags are confirmed to exist but their actual event schema is not yet verified).
- **Manual end-to-end verification** in a real opencode session: start a delegation, confirm progress is visible while it runs, send a follow-up and confirm it continues the same thread, switch delegates mid-conversation and confirm the switch takes effect, and confirm two separate opencode sessions delegating to the same CLI don't share thread state.

## Risks / Trade-offs

- **[Risk]** claude/kimi stream-json event shapes unverified beyond flag existence. → **Mitigation:** probe both live before implementing their metadata parsing (see Testing); fall back to opaque text on unrecognized lines.
- **[Risk]** Sticky delegation depends on the model continuing to follow the command's routing instruction every turn; it could drift back to answering directly. → **Mitigation:** word the instruction explicitly and unambiguously; revisit with a stronger mechanism if unreliable in practice.
- **[Risk]** In-memory session map is lost on opencode restart mid-task. → **Mitigation:** accepted for v1; underlying CLI session still exists on disk and can be resumed manually.
- **[Risk]** Each `*_start`/`*_reply` call blocks until the delegate's turn finishes, and spawns a fresh process each time — codex alone showed ~9-11s cold start via `mcp-server`; headless `codex exec` startup cost is separately unmeasured. → **Mitigation:** measure during implementation; consider a warm-process-per-session optimization later if too slow.

## Open Questions

- Exact JSONL event shapes for `claude -p --output-format stream-json` and `kimi --print --output-format stream-json`.
- Whether per-turn cold-start cost is acceptable as-is or needs a warm-process optimization before this feels responsive.

---

*This design was produced through iterative interview and live verification against the user's local environment; the same content also backs an OpenSpec change at `openspec/changes/cli-dispatch-plugin/` (proposal/design/specs/tasks), which is the implementation-tracking artifact. This document is the narrative record.*
