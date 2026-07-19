## Context

The user runs opencode as their day-to-day driver and has `codex` and `claude` (Claude Code) installed and authenticated locally. Each of those CLIs has its own agent loop, context/session management, and tool execution — the user explicitly wants to reuse that logic, not reimplement it or call the underlying model APIs directly with separate keys. (Kimi was considered as a third delegate and descoped: opencode can already use Kimi as a configured model provider, so a kimi CLI delegate adds nothing.)

Verified locally before writing this design:
- `codex mcp-server` is a real, working native MCP server (`codex`/`codex-reply` tools with `threadId` continuation) — confirmed via a raw JSON-RPC round trip and via `opencode mcp list` showing `connected`. It is a viable integration path but was not chosen (see Decisions).
- `claude mcp serve` exposes Claude Code's *raw tool belt* (Bash, Read, Edit, Skill, Agent, …) as 26 individual MCP tools, not a single "run the whole task" tool — connecting opencode to it would make opencode's own model the planner, defeating the goal of reusing Claude Code's own agent loop.
- Both CLIs support headless execution with structured streaming output and session resume:
  - `codex exec --json` (JSONL event stream) + `codex exec resume <id>`
  - `claude -p --output-format stream-json` + `--session-id <uuid>` / `--resume <uuid>`
- opencode's plugin SDK (`@opencode-ai/plugin`) exports a `tool()` helper with a `context.metadata()` callback for live progress reporting, and opencode auto-discovers project-local plugins from `.opencode/plugin/*.ts` (verified via `opencode debug config`, which listed the test plugin as a `local` scope entry with no manual registration needed).
- This project already has a precedent for per-CLI command/skill files living side by side: `.opencode/command/`, `.codex/prompts/`, `.claude/commands/opsx/`, `.cursor/commands/` all mirror the same openspec commands today.

## Goals / Non-Goals

**Goals:**
- Let the user delegate the current opencode conversation to codex or claude's own CLI agent loop via `/codex`, `/cc`, reusing each CLI's existing local authentication and session/context management.
- Support sticky multi-turn delegation: once a delegate is addressed, subsequent messages continue that delegate's session until another `/codex`/`/cc` command takes over.
- Surface live progress from the delegate while it runs, inside opencode's own UI.

**Non-Goals:**
- Not building or registering standalone MCP servers for claude, and not relying on `claude mcp serve` or `codex mcp-server` for the actual delegation path (see Decisions).
- Not delegating to the kimi CLI — Kimi is used directly as an opencode model provider instead.
- Not mirroring superpowers skills (e.g. `brainstorming`) into `~/.codex/skills` or another delegate CLI's skills directory yet — a delegated CLI runs with whatever skills/commands already exist in its own environment; making specific skills available there is separate, on-demand follow-up work.
- Not exposing this dispatch capability to other MCP clients (Claude Desktop, Cursor, etc.) — it is an opencode-only plugin.
- Not touching `~/ClaudeCodeKimi` / `~/.gemini-proxy` (unrelated model-swapping gateway for Claude Code, not part of this design).

## Decisions

**1. Plugin `tool()` API instead of MCP servers (per-CLI).**
Considered: (a) two standalone MCP servers, codex using its native `mcp-server` and claude via a hand-written stdio wrapper, registered through opencode's `mcp` config; (b) a single opencode plugin using `tool()` for both.
Chosen (b) because both CLIs already support headless mode with streaming JSON and session resume, so there is no capability gap to fill with a custom protocol — a single plugin gives one consistent code path, in-memory session-map lifecycle (no extra long-running server processes to manage/restart), and native progress reporting via `context.metadata()`. The MCP-reusability advantage of (a) (other MCP clients could reuse the same server) is not needed since this is opencode-only.

**2. `codex exec --json`, not `codex mcp-server`, for the codex delegate.**
`codex mcp-server` is real and works (verified), and its `codex`/`codex-reply` tools are arguably a closer match to "native" codex integration. It was not chosen so that both delegates share one implementation pattern (headless subprocess + JSONL stream + resume flag) instead of codex being special-cased through MCP while claude goes through a different, hand-rolled mechanism. This trades away codex's slightly richer built-in event schema for consistency across delegates.

**3. Sticky delegation via command-level instructions, not plugin-level input interception.**
The `/codex` and `/cc` command files are plain opencode prompt templates (matching the existing `.opencode/command/opsx-*.md` convention) that instruct the current model to call the matching `*_start` tool for the first message and `*_reply` for follow-ups, using the thread/session id the tool returned. The opencode plugin Hooks API does not offer a "rewrite which tool handles the next user message" hook, so routing is model-mediated: the model itself, following the command's instructions, keeps choosing to call `*_reply` until a different `/command` is invoked. This is a soft mechanism (relies on the model following instructions each turn), not a hard state machine.

**4. Session state lives in an in-memory `Map` inside the plugin, keyed by opencode session ID.**
Each entry stores which delegate is "active" and that delegate's own thread/session id. This is process-local — it does not survive an opencode restart. Acceptable because delegate CLIs also persist their own session transcripts on disk (`~/.codex/sessions/`, `~/.claude/projects/*/*.jsonl`) and can be resumed manually if the in-memory map is lost.

**5. Progress reporting parses each CLI's own JSONL stream, no file tailing.**
`context.metadata()` is updated as each tool's subprocess emits JSONL lines (codex: `codex/event`-shaped items; claude: `stream-json` events). This was chosen over tailing `~/.codex/sessions/…` / `~/.claude/projects/…` because it's simpler (no filesystem watching, no path-to-active-session lookup) now that both CLIs are confirmed to support streaming JSON output directly on stdout.

## Risks / Trade-offs

- **[Resolved]** `claude -p --output-format stream-json` event schema was live-probed during implementation (trivial prompt → `assistant` + `result` events; `--resume <uuid>` confirmed continuation), as was `codex exec --json` (`thread.started` carries `thread_id`; `item.completed` `agent_message` carries final text). Default flags confirmed non-interactive: codex `-c sandbox_mode=read-only --skip-git-repo-check`, claude `--permission-mode dontAsk`. Malformed/unexpected lines are treated as opaque text fallback rather than crashing the tool call.
- **[Risk]** Sticky delegation is model-mediated (Decision 3) — the model could ignore the instruction and stop calling `*_reply`, silently falling back to opencode's own reasoning mid-conversation. → **Mitigation:** command templates should state the sticky rule explicitly and unambiguously; acceptable to revisit with a stronger mechanism later if this proves unreliable in practice.
- **[Risk]** In-memory session map (Decision 4) is lost on opencode restart, mid-task. → **Mitigation:** acceptable for v1 per user's own scoping; the underlying CLI session still exists on disk and can be resumed by hand.
- **[Risk]** Headless subprocess calls block until the delegate's turn finishes (no MCP-style out-of-band notification); a long delegate task holds up that tool call. → **Mitigation:** this is inherent to the chosen approach and was accepted by the user; `context.metadata()` at least keeps opencode's UI showing live progress instead of a silent hang.
- **[Risk]** Each `*_start`/`*_reply` call spawns a fresh CLI process — codex alone showed ~9-11s cold-start overhead when going through `codex mcp-server`; headless `codex exec` startup cost has not been separately measured and may differ. → **Mitigation:** measure during implementation; if materially slow, consider keeping a warm subprocess per active delegate session instead of spawning per turn.

## Migration Plan

Additive only — new plugin and command files, no changes to existing code or configuration. Rollback is deleting the new files.

## Open Questions

- ~~Exact JSONL event shape for `claude -p --output-format stream-json`~~ — confirmed by live probe (see Risks above).
- Whether per-turn cold-start cost for `codex exec` (vs. the already-measured `codex mcp-server`) is acceptable, or whether a warm-process-per-session optimization is needed before this is pleasant to use.
