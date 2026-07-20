## Context

Delegation today works by prompt-level instructions: `cc.md`/`codex.md` tell the opencode agent "route every following message to `claude_reply`/`codex_reply`". These instructions live in the message stream, where any intervening command (e.g. `/opsx-explore`) injects competing instructions that override them — observed live: after `/cc`, entering explore mode made opencode answer with its own model again. There is also no exit path back to opencode.

Spike verification on opencode 1.18.3 (throwaway plugin, `opencode serve` + HTTP, later cleaned up) established:

- `experimental.chat.system.transform` fires on every LLM call **including command turns**, receives `sessionID`, and mutations to `output.system` demonstrably reach the model (injected marker token appeared in replies, on both plain-message and command turns).
- `command.execute.before` fires before message creation with `{ command, sessionID, arguments }` — plugin code can act on it deterministically.
- No hook can short-circuit the agent loop entirely; the model must still call the delegate tool. Design therefore minimizes the model's job to one trivial tool call under a system-prompt-priority rule.
- The spike ran against MiniMax-M3 (third-party provider); the system-level rule was honored — promising for the Kimi/third-party-API concern, though not conclusive for every model.

## Goals / Non-Goals

**Goals:**

- Sticky delegation survives any intervening non-delegate command (`/opsx-explore`, future commands).
- While delegated, command content (e.g. explore instructions) is forwarded to the delegate as prompt text, so the delegate handles it.
- `/opencode` exits delegation deterministically at the plugin layer.
- Mechanism works regardless of which provider/model opencode itself uses.

**Non-Goals:**

- True transport-level interception (impossible with current plugin API — verified).
- Changing how delegate CLIs are spawned (`delegates.ts` unchanged).
- Persisting delegation state across opencode restarts (in-memory store stays).
- Fixing the separate "UI session didn't load plugin tools" issue.

## Decisions

### D1: Inject routing rule via `experimental.chat.system.transform`

On every LLM call, check `getActiveDelegate(sessionID)`. If a delegate is active, append a routing rule to `output.system`. System prompt has the highest instruction priority and is re-injected every turn, so command-level instructions (explore mode, etc.) no longer override delegation — they become *content* that gets forwarded.

Alternatives considered:
- **Strengthen `cc.md` wording** — stays in the message stream; competes with same-level command instructions; reliability varies by model. Rejected.
- **Inject marker parts via `chat.message`** — still message-stream level; also mutating user-visible parts is surprising. Rejected.

Rule wording (reliability-critical, finalized in implementation) states: which delegate is active; take the user's latest message verbatim — including any command-injected text — and pass it as `prompt` to `<delegate>_reply`; return the tool output without adding commentary.

### D2: Exit via `command.execute.before` + new `/opencode` command

New `.opencode/command/opencode.md`. The plugin's `command.execute.before` hook: if `command === "opencode"`, call `clearActiveDelegate(sessionID)` immediately — no model involvement — and append a ground-truth note part describing what happened. The subsequent LLM turn then finds no active delegate, no rule is injected, and the command's own content plus the note part tell the agent how to confirm the exit.

Alternatives considered:
- **Exit tool the model must call** (`delegate_exit`) — reintroduces model-dependence at exactly the moment context may be confusing. Rejected.
- **Reusing `/cc` or `/codex` to exit** — ambiguous semantics (switch vs exit). Rejected.
- **Exit-into-agent** (e.g. binding `Command.agent` so `/opencode` lands in explore) — rejected (grilling Q2): exit is a routing-layer operation, agent selection is orthogonal and one step away after exit.

Concrete form (grilling Q2/Q3): plain exit only. `command.execute.before` checks `command === "opencode"`, records whether a delegation existed, calls `clearActiveDelegate(sessionID)`, and appends a text part to `output.parts` stating what happened ("cleared active claude delegation" / "no delegation was active") — the hook can mutate parts (verified in spike), so the model turn has ground truth even though state is already cleared. The command template tells the agent to relay that note in one or two sentences. Exit is final: the discarded external id is not retained; the next `/cc` starts a fresh delegate session (no resume semantics — a deliberate pause/resume feature would be separate commands, not this one).

### D3: Keep tool API and failure recovery unchanged

`claude_start`/`claude_reply`/`codex_start`/`codex_reply` stay as-is. `*_reply` still throws when no session exists; command docs keep the "fall back to `*_start`" recovery path. The system-rule injection only affects *whether* routing instructions are present, not how the tools work.

### D4: Agent mentions (`@explore`) forward with intent translation

Verified mechanics (opencode 1.18.3, HTTP path): an `@explore` mention is expanded into opencode-internal instruction text inside the current session's user message ("Use the above message and context to generate a prompt and call the task tool with subagent: explore") — no child session is created. Therefore mentions are already covered by the D1 routing rule, but forwarding the expansion jargon verbatim would confuse the delegate (it references opencode's `task` tool, which the delegate does not have). Decision (grilling Q1): while a delegation is active, the plugin's `chat.message` hook rewrites agent-mention expansion text into a plain-language statement of intent (e.g. "The user asks you to explore the following:") before the model turn; everything else forwards verbatim. Command expansions (e.g. `/opsx-explore`) are self-describing English and forward verbatim without rewriting.

Input-form taxonomy while delegated:

| Input form | Mechanics | Handling |
|---|---|---|
| Plain message | user text part | forward verbatim |
| Custom command (`/opsx-*`) | template injected as user message | forward verbatim (self-describing) |
| Agent mention (`@explore`) | jargon expansion in user message | rewrite to intent, then forward |
| Built-in TUI commands (`/compact`, `agent_cycle`, …) | separate TUI endpoint, no model turn | never reach the model; unaffected by construction |

### D5: Delegate failure keeps state, error text points at the exit

When a delegate call fails (binary missing, auth expired, delegate-side error), the delegation state is preserved and the returned error text gains a hint to use `/opencode` to exit (grilling Q4). Rationale: clearing on failure would be destructive — transient errors would discard the external session id with no clean way back. Auto-exit and failure counters were considered and rejected as state machines solving a wording problem.

## Risks / Trade-offs

- [Model may still fail to call the tool even under a system rule] → Keep the rule short and absolute; task is a single tool call; tool errors are descriptive and self-healing (reply-throws → start).
- [Multiple plugins composing `system.transform` could interleave unexpectedly] → Our hook only appends; verify order during implementation if other transforms appear.
- [User issues `/opencode` when not delegated] → `clearActiveDelegate` is a no-op; command doc tells the agent to reply that no delegation was active.
- [Forwarded command content may confuse the delegate CLI] → Acceptable: delegate receives it as plain prompt text; explore-mode text is self-describing. Evaluated during implementation with a real `/cc` + `/opsx-explore` sequence.
- [Long delegated sessions grow the opencode-side transcript with tool call/response pairs] → Existing compaction handles it; out of scope.
- [Switching to the plan agent mid-delegation may block `*_reply` tools under plan-mode permissions, and `system.transform` receives no agent name so injection cannot be skipped per-agent] → Documented as a known limitation; revisit if it bites in practice. Resolved in `delegate-permission-passthrough` (2026-07-20): live spike found no `permission.ask` event ever fires for custom plugin tools (agent restrictions are system-prompt-enforced, not permission-event-mediated), so the fix is a `chat.message`-populated per-session agent cache plus an explicit actionable message from `*_reply` when the cached agent is known-restrictive (`plan` confirmed).

## Open Questions

(none — resolved via grilling: routing rule in English, validated against Kimi/MiniMax in task 5.1 with bilingual as fallback; exit is fresh-start with no resume)
