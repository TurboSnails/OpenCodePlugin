# cli-dispatch.config.json

Configuration for the `opencode-cli-dispatch` OpenCode plugin (loaded from
`file:/Users/hassan/.local/share/opencode-plugins/opencode-cli-dispatch` in
`~/.config/opencode/opencode.json`).

## Schema

`{ "delegates": { ... }, "verifiedModels": [ ... ] }`

`delegates` keys become the prefix of three auto-registered tools:
`{name}_start`, `{name}_reply`, `{name}_check`. The default config ships
`claude` and `codex`.

`verifiedModels` is an optional allow-list of `"provider/model"` strings. The
plugin's `command.execute.before` hook refuses to start a `/cc` or `/codex`
delegation if the active model isn't on the list. This is a runtime gate — it
catches models (e.g. `minimax-cn/MiniMax-M3`) that have been verified to ignore
the sticky-routing contract.

Each entry is `"provider/model"`. Each segment supports an optional trailing
`*` wildcard. Examples:

- `"kimi-for-coding/k3"` — exact match.
- `"kimi-for-coding/k*"` — match any Kimi k-series model.
- `"*/*"` — match everything (same as omitting the field entirely; the gate
  fails open).

If the field is omitted, the plugin fails open and gates nothing.

## Verified list (2026-07-21)

```json
[
  "kimi-for-coding/k3",
  "opencode/deepseek-v4-flash-free"
]
```

- `kimi-for-coding/k3` — verified working by upstream plugin maintainers.
- `opencode/deepseek-v4-flash-free` — verified working by `hassan` on this
  machine; both plugins loaded and `claude_start` registered after the
  2026-07-21 config consolidation.

## Adding a new model

1. Run `claude_check` (or `codex_check`) to confirm the delegate binaries work
   on this machine.
2. Send `/cc "hello"` to test delegation end-to-end.
3. If the first sticky follow-up message (no `/cc` prefix) is still routed to
   the delegate, the model honors the contract — add it to `verifiedModels`.
4. If it answers directly, the model does NOT honor the contract — do NOT add
   it; the gate will (correctly) refuse to start a delegation with that model.

## After installing or updating the plugin

opencode loads plugins once at startup. After installing or updating
opencode-cli-dispatch (or regenerating slash commands), quit and restart
opencode. Long-running sessions started before an update will not have the
`claude_start` / `codex_start` tools; the `/cc` and `/codex` commands detect
this and tell you to restart.

## Recovery

If opencode refuses to start because of a malformed config, set
`OPENCODE_DISABLE_PROJECT_CONFIG=1` to skip this file and start from globals
only.