---
description: Delegate this conversation to the kimi CLI (sticky - follow-ups keep going to kimi until another /codex, /cc, or /kimi command is used)
---

Delegate this conversation to the kimi CLI.

**Right now:** if no kimi session is active yet for this conversation, call the `kimi_start` tool with the user's message (the text after `/kimi`, or the whole message if `/kimi` was sent alone) as the `prompt` argument. If a kimi session is already active, call `kimi_reply` instead. Return the tool's response to the user as your answer — do not add your own commentary on top of it unless the user asks a question about it separately.

**For every message after this one** — until the user runs `/codex`, `/cc`, or `/kimi` again — do not answer directly and do not reason about the request yourself. Instead call `kimi_reply` with the user's new message as the `prompt` argument, and return its response. This applies even when the message has no command prefix.

If `kimi_reply` fails because no kimi session is active (e.g. it was never started, or opencode restarted since), call `kimi_start` instead and continue from there.
