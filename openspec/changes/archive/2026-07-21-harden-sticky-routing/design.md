## Context

Sticky delegation (`cli-dispatch` capability) has two enforcement layers today, both pure natural-language convention:

1. The generated command markdown (`src/commands.ts`'s `DELEGATE_COMMAND_TEMPLATE`) tells the model to call `{name}_start`/`{name}_reply` and extract the user's actual text as the `prompt` argument.
2. `experimental.chat.system.transform` (`src/hooks.ts#makeSystemTransform`, built from `src/routing-rule.ts#buildRoutingRule`) injects a system-prompt sentence asking the model to keep routing to `{name}_reply` instead of answering directly.

Neither is enforced by the host. `.opencode/command/cc.md` currently documents a manually-verified failure (MiniMax-M3, 2026-07-19): it forwards the whole expanded template text as the `prompt` argument instead of just the user's text, and on follow-ups it ignores the routing rule and answers directly with no tool call at all.

A prior change (`archive/2026-07-20-delegate-permission-passthrough`) already spiked the available `@opencode-ai/plugin` hook surface for a related problem (restrictive agents silently blocking delegate tool calls) and found, via a live `opencode serve` session with a debug hook, that **`permission.ask` never fires for custom plugin tool calls** in opencode 1.18.3 — only opencode's own built-in tools go through that gate. That result does not generalize to `tool.execute.before`, which is a different hook, but it sets the precedent this design follows: don't assume a hook fires for custom tools without a live spike.

`command.execute.before` is already confirmed working for this plugin — it deterministically clears delegation state for `/opencode` today (`src/hooks.ts#makeCommandBefore`), independent of the model.

## Goals / Non-Goals

**Goals:**
- Stop a delegation from ever starting when the active session's model is known to mishandle the delegation contract (config-driven allow-list, not a hardcoded blacklist).
- Reject/sanitize a `prompt` argument that is clearly the whole expanded command template rather than user text, before it reaches the delegate CLI.
- Preserve full backward compatibility: no `verifiedModels` configured means no behavior change.
- Remove the model-blacklist prose from command docs in favor of the runtime mechanism.

**Non-Goals:**
- Guaranteeing a model *will* call `{name}_reply` on every sticky follow-up. No hook exists in the current `@opencode-ai/plugin` surface that fires when a model answers with plain text and calls no tool at all (confirmed by inspecting `node_modules/@opencode-ai/plugin/dist/index.d.ts`: every hook is keyed on a tool call, a command, or a pre-LLM message transform). A model that silently ignores the routing rule and never calls a tool cannot be intercepted post-hoc; this change narrows how much damage that failure mode can do (by blocking known-bad models at the door) rather than eliminating it.
- Building a general model-capability-detection system. `verifiedModels` is a manually curated allow-list, not an automated benchmark.

## Decisions

### D1: Gate at `command.execute.before`, not `permission.ask`
`permission.ask` is confirmed dead for custom tools (see Context). `command.execute.before` already runs deterministically before any model turn for slash commands and is the mechanism `/opencode` already uses to clear state without depending on the model. Blocking here means `{name}_start` is never even offered to the model for an unverified session — the model can't mis-forward a template it's never invited to construct in the first place, for the *first* message. This is the same reasoning as the existing "Exit delegation back to opencode" requirement: deterministic host-side state changes beat asking the model nicely.

**Spike correction (2026-07-21):** a live spike (persistent `opencode serve` 1.18.3, `/cc` fired via `POST /session/{id}/command`) revealed two things that change how D1 must be implemented:

1. **`output.parts` at hook entry already contains the fully expanded command template text**, not an empty array the hook populates from scratch:
   ```
   partsAtEntry: [{"type":"text","text":"Delegate this conversation to the claude CLI...
     call the `claude_start` tool with the user's message...
     reply with exactly: SPIKE_PARTS_TEST"}]
   ```
   This means the existing `/opencode` handler's pattern (`output.parts.push(note)`) *adds to* the model's context rather than replacing it. For `/opencode` that's fine — the pushed note doesn't need to suppress anything. For a delegation-start block it is not fine: merely pushing a warning next to "call `claude_start`" leaves both instructions in front of the model and degrades back into the same soft-prompt problem this change exists to avoid. **Blocking must clear `output.parts` and replace it with only the block message** (`output.parts.length = 0` then push), not append to it.
2. **`input.command` is the literal slash command name the user typed (`"cc"`), not the delegate key (`"claude"`)**. This repo's own hand-maintained `.opencode/command/cc.md` is a shorthand alias — it does not follow `src/commands.ts`'s generated-command convention where the file (and therefore the command name) is named exactly after the delegate key. There is no config-level mapping from an arbitrary command name to the delegate it targets, so `input.command in config.delegates` would correctly match `/codex` but silently fail to match `/cc` — the exact case this change was written to cover.

   Fix: detect the targeted delegate by scanning the **already-queued `output.parts` text** (not the command name) for `` `{name}_start` `` for each configured delegate name, e.g. the queued text containing `` `claude_start` `` identifies this as a `claude`-start command regardless of what the slash command itself is called. This works because every delegate-start command template (generated or hand-maintained) instructs the model to call that exact tool name — it's the one piece of text guaranteed to name the delegate unambiguously.

### D2: Track model per-session the same way `sessionAgents` already works
`chat.message`'s `input.model: { providerID, modelID }` is already available and unused. Mirror the existing `sessionAgents: Map<sessionID, agent>` pattern in `src/session-store.ts` with `sessionModels: Map<sessionID, {providerID, modelID}>`, written in `makeChatMessage` alongside the existing `setSessionAgent` call. No new hook needed for this part.

Consequence: the model is only known *after* the first message in a session has gone through `chat.message`. If `/cc` is the very first message ever sent in a brand-new opencode session, is `chat.message` guaranteed to fire before `command.execute.before` for that same message?

**Spike result (2026-07-21, live `opencode serve` 1.18.3, same methodology as the archived `delegate-permission-passthrough` spike):** confirmed **no** — `command.execute.before` fires *before* `chat.message` for a session's first message. Observed log order for a fresh session's first `/cc` command (`minimax-cn/MiniMax-M2.5`):
```
command session.id=... command=cc agent=undefined
[SPIKE] command.execute.before fired {"command":"cc","sessionID":"..."}
[SPIKE] chat.message fired {"sessionID":"...","model":{"providerID":"minimax-cn","modelID":"MiniMax-M2.5"},"agent":"build"}
```
`command.execute.before` ran ~2ms before `chat.message`. This confirms the gate cannot rely on the model being known on a session's very first command; the fail-open policy is not just a fallback but the *required* behavior for that case: **unknown model is allowed through**, matching this change's backward-compatibility goal and avoiding a chicken-and-egg block on every fresh session. A model becomes "known" starting with that same message's `chat.message` firing, so it *is* available for the session's second and later delegate-start commands (e.g. `/codex` issued after `/cc` already ran once in the session).

### D3: `verifiedModels` is an allow-list, not a blacklist, and lives at the top level of `cli-dispatch.config.json`
An allow-list (vs. the blacklist prose it replaces) means new unverified models are safe-by-default-if-unconfigured (no restriction at all unless the user opts in) but strict-once-opted-in (only listed models proceed) — better matches "we've only confirmed these work" than "we've only seen these fail," since the set of models nobody has tried yet is far larger than the set of models caught misbehaving so far. Lives at the top level (sibling to `delegates`), not per-delegate, because model behavior toward the *routing contract* is orthogonal to which CLI is being delegated to.

Match syntax: plain strings compared as `providerID/modelID`, supporting a trailing `*` wildcard on either segment (e.g. `anthropic/*`, `*/kimi-for-coding-k3`) — simple glob, no regex, consistent with the project's existing preference for minimal config surface (see `config.ts`'s existing validation style).

### D4: Prompt sanitization via a new `tool.execute.before` hook — confirmed working
Unlike `permission.ask`, `tool.execute.before` was not previously confirmed to fire for this plugin's dynamically-registered tools in opencode 1.18.3.

**Spike result (2026-07-21, live `opencode serve` 1.18.3):** confirmed **yes** — a throwaway debug hook wired to `tool.execute.before` fired for a real `claude_start` call issued by `minimax-cn/MiniMax-M2.5`, with `output.args` populated and mutable before the tool actually ran:
```
[SPIKE] tool.execute.before fired {"tool":"claude_start","sessionID":"...","args":{"prompt":"hello world spike test"}}
```
This is the same `output.args` object the tool's `execute()` subsequently receives, confirming it can be rewritten (or the call rejected by throwing) before the delegate CLI is ever spawned. No fallback to an in-tool guard clause is needed — implement as a `tool.execute.before` hook in `src/hooks.ts`, wired alongside the existing hooks in `src/index.ts`, checking `input.tool` against the configured `{name}_start`/`{name}_reply` tool names.

Detection heuristic: the `prompt` argument is judged "template mistakenly forwarded" if it contains `commands.ts`'s `GENERATED_MARKER` string. This is a strong, unambiguous signal (a real user message will essentially never contain that literal HTML comment) with zero known false-positive risk, unlike a fuzzier "looks like the template" text-similarity check.

### D5: Command docs stop naming specific bad models
`.opencode/command/cc.md`'s and `.opencode/command/codex.md`'s "Known limitations" paragraphs (both carried the identical MiniMax-M3 text) have been deleted. `src/commands.ts`'s generated `DELEGATE_COMMAND_TEMPLATE`/`OPENCODE_COMMAND_TEMPLATE` were checked directly and never carried this text (`cc.md`/`codex.md` are hand-maintained files, not generated — no `GENERATED_MARKER` present in either), so no generator change was needed. The allow-list mechanism is the runtime source of truth going forward; a stale blacklist paragraph in prose would drift from it immediately and mislead users into thinking the *documented* list is exhaustive.

## Risks / Trade-offs

- [Model answers with no tool call at all on a sticky follow-up, after being let through the initial `/cc` gate] → Not fixable with current hook surface (see Non-Goals). Mitigation is narrowing blast radius, not elimination: verified models are curated to exclude models with this known behavior; the existing system-prompt routing rule remains as the soft mitigation for verified-but-imperfect models.
- [`command.execute.before` runs before `chat.message` populates the model cache for a session's very first message] → Confirmed live (see D2); fail-open (unknown model allowed) is the designed behavior for this case, not just a fallback.
- [Allow-list wildcard syntax could be under-specified for edge cases (e.g. case sensitivity of provider/model ids)] → Keep matching case-sensitive and exact-or-trailing-`*` only; document this precisely rather than building a general glob engine.

## Migration Plan

No migration needed — `verifiedModels` is optional and additive. Existing `cli-dispatch.config.json` files without the field are valid as-is and impose no new restriction. Rollout is: ship the mechanism unconfigured (no behavior change), then the project's own `cli-dispatch.config.json` can opt in once the allow-list is populated with models actually verified to honor the routing contract (currently: Claude models, `kimi-for-coding/k3` per the paragraph being removed from `cc.md`).

## Open Questions

None remaining. Both were resolved by a live spike on 2026-07-21 against opencode 1.18.3 (see D2 and D4): `tool.execute.before` fires for this plugin's custom-registered tools with mutable `args`, and `command.execute.before` fires before `chat.message` on a session's first message (fail-open confirmed necessary, not optional).
