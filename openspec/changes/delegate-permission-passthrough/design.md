## Context

Reported symptom: user still sees a "no write permission" response when delegating through opencode, despite the delegate CLI config regression already being fixed (`delegate-execution-safeguards`, archived). Live verification during this investigation (2026-07-20) confirms the CLI-config layer works:

```
claude: { "ok": true, "detail": "claude is writable (created: healthcheck.txt)" }
codex:  { "ok": true, "detail": "codex is writable (created: healthcheck.txt)" }
```

(ran `checkDelegate` from `src/health-check.ts` directly against the live `cli-dispatch.config.json`, both delegates spawned for real and wrote a file in an isolated temp dir.)

So the remaining symptom is not delegate CLI config. Cross-referencing `sticky-cli-delegation`'s design.md known limitation:

> Switching to the plan agent mid-delegation may block `*_reply` tools under plan-mode permissions, and `system.transform` receives no agent name so injection cannot be skipped per-agent → Documented as a known limitation; revisit if it bites in practice.

This change is that "revisit."

## Two candidate mechanisms (need a spike to pick between them)

### M1: `permission.ask` hook (opencode's own approval gate)

`@opencode-ai/plugin`'s `Hooks` type exposes:

```ts
"permission.ask"?: (input: Permission, output: { status: "ask" | "deny" | "allow" }) => Promise<void>
```

where `Permission` (from `@opencode-ai/sdk`) is:

```ts
type Permission = {
  id: string
  type: string
  pattern?: string | string[]
  sessionID: string
  messageID: string
  callID?: string
  title: string
  metadata: Record<string, unknown>
  time: { created: number }
}
```

If the "no write permission" block manifests as a `permission.ask` event (i.e. opencode does ask, just not visibly/successfully resolved for the user, or gets auto-denied by a session-level rule before the user can respond), the plugin can intercept it: when `getActiveDelegate(input.sessionID)` is truthy, set `output.status = "allow"` and skip the prompt entirely. This directly satisfies "don't ask every time" — and it's opencode's own approval mechanism, so it's not a new invention.

Evidence this may be relevant: session records logged at creation include a baked-in permission rule set, e.g.:
```
permission=[{"permission":"question","pattern":"*","action":"deny"},{"permission":"plan_enter","pattern":"*","action":"deny"},{"permission":"plan_exit","pattern":"*","action":"deny"}]
```
This shows opencode has per-session default rules for at least `question`/`plan_enter`/`plan_exit` categories set to `deny` — plausible that a similar rule denies write-related asks while a restrictive agent is active, without ever surfacing an interactive prompt the user could approve.

### M2: Tool-availability filtering (no hook to intercept)

Alternative theory: a restrictive agent (e.g. plan agent) doesn't go through `permission.ask` at all — it simply excludes write-capable tools (including `claude_reply`/`codex_reply`) from what the model is allowed to call, or opencode's own agent loop refuses the tool call outright. In this case there is no permission event to intercept; the fix instead has to happen earlier, e.g.:
- Detect the active agent (via `chat.message`'s `agent` field, cached per session — `system.transform` itself doesn't receive `agent`, so this requires a small cross-hook cache) and surface an explicit message ("delegation is active but the current agent can't call delegate tools — switch agents or use `/opencode` to exit") instead of a silent/confusing failure.
- This does not fully satisfy "never ask again," but it converts a silent block into an actionable one, which was the proposal's fallback goal.

## Decision: spike first

Task 1 must reproduce the block live (start a delegation, switch to a restrictive agent or session-permission profile, attempt `*_reply`) and read `opencode.log` for a `permission.ask`/`evaluated permission=...` entry at the moment of failure. That determines M1 vs M2. Do not commit to an implementation before this is confirmed — the two mechanisms live in different hooks and have different user-facing outcomes (silent auto-allow vs. explicit message).

## Non-goal callback: option B (interactive per-write approval bridge to the CLI itself)

Checked both CLIs' `--help` output directly (`claude --help`, `codex exec --help`, 2026-07-20): neither exposes a per-call approval callback in headless/exec mode. `claude -p` only has `--permission-mode <acceptEdits|auto|bypassPermissions|manual|dontAsk|plan>` and `--dangerously-skip-permissions`; `codex exec` only has `-c sandbox_mode=<read-only|workspace-write|danger-full-access>` and `--dangerously-bypass-approvals-and-sandbox`. Building a true "CLI pauses mid-write, opencode's UI approves it, CLI resumes" bridge would require either an undocumented/unstable extension point or abandoning headless invocation — out of scope here. `permission.ask` (M1) gets most of the practical benefit (opencode's own approval window, per session) without touching the CLI invocation model at all.

## Spike results (2026-07-20)

Attempted live reproduction via `opencode run` (headless, ephemeral server per invocation):

1. `opencode run -m minimax-cn/MiniMax-M3 --agent plan "Call claude_start with prompt 'Reply with exactly: SPIKE_PLAN_OK'"` — **succeeded**. The model called `claude_start` under the `plan` agent with no permission prompt, no denial, no block. `plan` agent's baked-in permission profile (`opencode agent list`) does deny `edit: * → deny`, but that rule evidently gates opencode's own built-in edit tool, not custom plugin tools — a custom tool call is not visibly mediated by that rule.
2. Attempted to test the *sticky* path (a `claude_reply` follow-up reusing the session-store state from step 1) by continuing the same session ID (`-s <id>`, `-c`). Both attempts got `No active claude session for this conversation. Call claude_start first.` — not a permission block, but because `opencode run` boots a fresh ephemeral server process per invocation ("disposing instance" in the logs after each run) and the plugin's session-store is in-memory, scoped to that process. Step 1's delegate state did not survive into step 2's process. This is expected per `sticky-cli-delegation`'s design (in-memory store, no cross-restart persistence) — it means `opencode run` cannot properly exercise the sticky/follow-up scenario; that requires a persistent `opencode serve` + same-process HTTP session (as prior debugging sessions in `opencode.log` did with `curl .../session/$SID/message`), which was not set up in this pass.

**Conclusion: the original hypothesis (plan agent blocks the delegate tool call itself) did not reproduce** in the part that could be tested. The user's reported "no write permission" symptom remains unconfirmed against a live repro. Before implementing either M1 or M2, we need either (a) the user's exact repro steps (which agent, TUI vs `opencode run`, one-shot vs follow-up message), or (b) a persistent `opencode serve` session set up to properly test the sticky follow-up path under a restrictive agent.

Unrelated finding, out of scope: a third-party global plugin fails to load on every opencode invocation — `~/.config/opencode/plugins/crg-plugin.ts`: `app.on is not a function`. Worth flagging to the user separately; not part of this change.

## Spike results, part 2: persistent `opencode serve` session (2026-07-20)

Set up a persistent `opencode serve --port 4193` (project directory, `.opencode/plugin/cli-dispatch.ts` loaded — confirmed live via a real `claude_start` tool call succeeding; only the unrelated global `crg-plugin.ts` failed to load, matching the earlier spike note). Created one session via `POST /session`, then drove it entirely through same-session `POST /session/$SID/message` calls (matching how prior debugging sessions used `opencode.log`), so the in-memory session-store issue from spike part 1 didn't apply here.

Added a throwaway `makePermissionAskDebug()` in `src/hooks.ts` wired to `"permission.ask"` in `src/index.ts`'s returned `Hooks` object — logged every `permission.ask` invocation with full input/output via `console.error` (visible in `--print-logs` server output). Removed after the spike; not part of the shipped diff.

Reproduced the target scenario end-to-end under `agent: "plan"` (MiniMax-M3, same model as the first spike):
1. `claude_start` called and completed successfully (verified via the tool's recorded output in the session transcript: exact echoed string from the real `claude` CLI).
2. A same-session follow-up message instructed the model to call `claude_reply`. The tool **was actually invoked** (confirmed via the transcript's `tool` part, not just described) and returned an error: `No active claude session for this conversation. Call claude_start first.` — this is the explicit `Error` thrown by `delegate-tools.ts`'s `makeReplyTool` (app-level, not an opencode permission block).

Across all three tool invocations (2× `claude_start`, 1× `claude_reply`) under the `plan` agent's restrictive profile, **zero `permission.ask` events were logged** by the debug hook. The server log likewise never mentions `permission` in connection with any of these calls (the only `permission` log line all session is the session-creation record, `permission=undefined`, since this test session had no baked-in permission ruleset attached at creation).

**Conclusion: M2 confirmed.** `permission.ask` does not fire for custom plugin tool calls in opencode 1.18.3. Plan-mode/agent restrictions are enforced through the system prompt injected into the model (visible directly in the model's own reasoning trace: *"the system reminder... STRICTLY FORBIDDEN: ANY file edits, modifications, or system changes"*), not through an interceptable permission event — there is no `output.status` gate for the plugin to flip to `"allow"`. M1 (`permission.ask` auto-allow hook) would be a no-op for this code path and should not be implemented; task 2a is dropped. Task 2b (explicit actionable-failure message via a per-session agent cache) is the correct path.

### Related but separate finding (not part of this change's scope)

The `claude_reply` failure above is **not** a permission/agent-restriction issue at all — it reproduces identically outside of `plan` agent too. Root cause: `src/parse-events.ts`'s `parseClaudeLine` never returns `externalId` (only `parseCodexLine` does, from `thread.started`'s `thread_id`). `makeStartTool` in `src/delegate-tools.ts` only calls `setActiveDelegate(...)` `if (result.externalId)` — since the claude parser never populates it, `claude_start` never registers an active session for the `claude` delegate, so every `claude_reply` fails with "No active claude session," permission gating aside. This fully explains why the sticky follow-up path could never be reproduced in spike part 1 (not the ephemeral-server session-store issue as originally guessed — that was real too, but even a persistent server hits this). Worth its own fix/change; flagged here for visibility, out of scope for `delegate-permission-passthrough`.

## Implementation (M2 path, task 2b)

- `src/session-store.ts` gained a second cache, `sessionAgents: Map<sessionID, agent>`, alongside the existing delegate-session cache, with `getSessionAgent`/`setSessionAgent`.
- `src/hooks.ts`'s `makeChatMessage` now also writes to that cache whenever the `chat.message` hook input carries an `agent` field (it's optional and only present on some messages; absence leaves the last-cached value untouched).
- `src/delegate-tools.ts`'s `makeReplyTool` checks the cached agent against `RESTRICTIVE_AGENTS` (currently `{"plan"}`) before invoking the delegate CLI, and short-circuits with an explicit message naming the agent and pointing at `/opencode` instead of running the CLI.
- Known-restrictive agents: **`plan`** — confirmed live (spike parts 1 and 2, design.md above) to inject a system-prompt rule forbidding file edits/tool calls, with no interceptable `permission.ask` event. Other built-in or custom agents are unconfirmed (TBD) and are not in the set; add them here as they're confirmed to avoid over-blocking agents that are actually fine.

## Open Questions

None remaining for the M1/M2 decision — resolved above (M2 confirmed). The `claude` delegate's `externalId` extraction bug is a new, separate open item (see previous section) that should become its own change.
