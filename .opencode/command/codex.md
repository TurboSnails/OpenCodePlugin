---
description: Delegate this conversation to the codex CLI (sticky - follow-ups keep going to codex until another /codex or /cc command is used)
---

Delegate this conversation to the codex CLI.

**Right now:** if no codex session is active yet for this conversation, call the `codex_start` tool with the user's message (the text after `/codex`, or the whole message if `/codex` was sent alone) as the `prompt` argument. If a codex session is already active, call `codex_reply` instead. Return the tool's response to the user as your answer — do not add your own commentary on top of it unless the user asks a question about it separately.

**For every message after this one** — until the user runs `/codex` or `/cc` again — do not answer directly and do not reason about the request yourself. Instead call `codex_reply` with the user's new message as the `prompt` argument, and return its response. This applies even when the message has no command prefix.

If `codex_reply` fails because no codex session is active (e.g. it was never started, or opencode restarted since), call `codex_start` instead and continue from there.

**Exiting delegation:** run `/opencode` to end the delegation for this session (cleared deterministically by the plugin; afterwards opencode answers directly again). While a delegation is active, ALL user input is forwarded to codex as prompt content — including non-delegate commands (e.g. `/opsx-explore`) and agent mentions (e.g. `@explore`). If codex fails, the error message will remind you about `/opencode`; the delegation stays active so you can fix the problem and continue, or exit.

**Known limitations:** MiniMax-M3 (provider `minimax-cn` / `minimaxi-cn`, the `opencode serve` default in some setups) does not honor this delegation. Verified 2026-07-19: it forwards the entire expanded command template as the `codex_start` prompt (instead of just your `/codex` arguments), and it ignores the sticky routing rule on plain follow-ups — answering directly instead of calling `codex_reply` — even with bilingual (English+Chinese) and doubly-injected routing rules. Use Kimi (`kimi-for-coding/k3`, verified working with the claude delegate) or another instruction-following model for delegation.
