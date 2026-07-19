---
description: Delegate this conversation to the claude (Claude Code) CLI (sticky - follow-ups keep going to claude until another /codex or /cc command is used)
---

Delegate this conversation to the claude CLI (Claude Code).

**Right now:** if no claude session is active yet for this conversation, call the `claude_start` tool with the user's message (the text after `/cc`, or the whole message if `/cc` was sent alone) as the `prompt` argument. If a claude session is already active, call `claude_reply` instead. Return the tool's response to the user as your answer — do not add your own commentary on top of it unless the user asks a question about it separately.

**For every message after this one** — until the user runs `/codex` or `/cc` again — do not answer directly and do not reason about the request yourself. Instead call `claude_reply` with the user's new message as the `prompt` argument, and return its response. This applies even when the message has no command prefix.

If `claude_reply` fails because no claude session is active (e.g. it was never started, or opencode restarted since), call `claude_start` instead and continue from there.

**Exiting delegation:** run `/opencode` to end the delegation for this session (cleared deterministically by the plugin; afterwards opencode answers directly again). While a delegation is active, ALL user input is forwarded to claude as prompt content — including non-delegate commands (e.g. `/opsx-explore`) and agent mentions (e.g. `@explore`). If claude fails, the error message will remind you about `/opencode`; the delegation stays active so you can fix the problem and continue, or exit.

**Known limitations:** MiniMax-M3 (provider `minimax-cn` / `minimaxi-cn`, the `opencode serve` default in some setups) does not honor this delegation. Verified 2026-07-19: it forwards the entire expanded command template as the `claude_start` prompt (instead of just your `/cc` arguments, causing claude to refuse as a suspected injection), and it ignores the sticky routing rule on plain follow-ups — answering directly instead of calling `claude_reply` — even with bilingual (English+Chinese) and doubly-injected routing rules. Use Kimi (`kimi-for-coding/k3`, verified working) or another instruction-following model for delegation.
