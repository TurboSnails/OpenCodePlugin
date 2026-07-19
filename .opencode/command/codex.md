---
description: Delegate this conversation to the codex CLI (sticky - follow-ups keep going to codex until another /codex or /cc command is used)
---

Delegate this conversation to the codex CLI.

**Right now:** if no codex session is active yet for this conversation, call the `codex_start` tool with the user's message (the text after `/codex`, or the whole message if `/codex` was sent alone) as the `prompt` argument. If a codex session is already active, call `codex_reply` instead. Return the tool's response to the user as your answer — do not add your own commentary on top of it unless the user asks a question about it separately.

**For every message after this one** — until the user runs `/codex` or `/cc` again — do not answer directly and do not reason about the request yourself. Instead call `codex_reply` with the user's new message as the `prompt` argument, and return its response. This applies even when the message has no command prefix.

If `codex_reply` fails because no codex session is active (e.g. it was never started, or opencode restarted since), call `codex_start` instead and continue from there.
