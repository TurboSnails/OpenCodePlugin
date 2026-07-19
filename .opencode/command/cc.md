---
description: Delegate this conversation to the claude (Claude Code) CLI (sticky - follow-ups keep going to claude until another /codex, /cc, or /kimi command is used)
---

Delegate this conversation to the claude CLI (Claude Code).

**Right now:** if no claude session is active yet for this conversation, call the `claude_start` tool with the user's message (the text after `/cc`, or the whole message if `/cc` was sent alone) as the `prompt` argument. If a claude session is already active, call `claude_reply` instead. Return the tool's response to the user as your answer — do not add your own commentary on top of it unless the user asks a question about it separately.

**For every message after this one** — until the user runs `/codex`, `/cc`, or `/kimi` again — do not answer directly and do not reason about the request yourself. Instead call `claude_reply` with the user's new message as the `prompt` argument, and return its response. This applies even when the message has no command prefix.

If `claude_reply` fails because no claude session is active (e.g. it was never started, or opencode restarted since), call `claude_start` instead and continue from there.
