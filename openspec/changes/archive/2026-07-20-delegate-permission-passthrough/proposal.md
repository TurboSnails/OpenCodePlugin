## Why

The delegate CLIs' own write-permission config regression is already fixed and live-verified (`delegate-execution-safeguards`: `bypassPermissions`/`workspace-write` defaults, `{name}_check` health tool, both `claude_check` and `codex_check` pass against real subprocesses). Despite that, the user still hits a "no write permission" prompt when delegating through opencode. That symptom is not the CLI config — it is opencode's own permission layer (`bash`/`edit`/`plan_enter`/`plan_exit`/`question` categories, visible in `~/.local/share/opencode/log/opencode.log`) gating the request *before* the delegate subprocess ever runs. `sticky-cli-delegation`'s design.md already flagged this as a known, unfixed limitation: switching to the plan agent mid-delegation can block `*_reply` tool calls under plan-mode permissions, and `experimental.chat.system.transform` receives no agent name so the plugin cannot detect or work around it.

Two mechanisms discovered during investigation change what's feasible here:
- `chat.message` hook input includes `agent?: string` — the plugin can observe and cache the active agent per session, even though `system.transform` itself doesn't receive it.
- opencode exposes a `permission.ask` hook: `(input: Permission, output: { status: "ask" | "deny" | "allow" })`, where `Permission` includes `sessionID`, `type`, and `pattern`. This is a first-class hook into opencode's own approval gate — a plugin can auto-resolve permission asks tied to an active-delegation session instead of only reacting to how those asks got denied.

This means "route permission back to opencode's own approval window" (the user's option B) may not require abandoning the delegate CLIs' headless invocation at all — `permission.ask` is opencode's approval window, already reachable from the plugin layer. Whether that's the actual chokepoint, or whether plan-mode instead filters out tool availability before any permission event fires, is unconfirmed and is the first thing this change must spike.

## What Changes

- Spike: reproduce the "no write permission" prompt under a plan-agent (or other restrictive-agent) delegation session, and determine whether it surfaces via the `permission.ask` hook or via tool-availability filtering that happens earlier (no hook to intercept).
- If `permission.ask` is the chokepoint: add a `permission.ask` hook that auto-allows permission asks whose `sessionID` has an active delegation (`getActiveDelegate`), so the user is never prompted while delegated — the CLI's own `bypassPermissions`/`workspace-write` config already makes the underlying write safe.
- If tool-availability filtering is the chokepoint instead: use the `chat.message` hook's `agent` field to cache the active agent per session, and have `system.transform` (or a new check at tool-call time) detect a restrictive agent and either skip delegation-breaking behavior or surface an explicit, actionable message instead of a silent block.
- Document the outcome in `sticky-cli-delegation`'s known-limitations note (currently in the archived change's design.md) is superseded — record the resolution (or the confirmed remaining constraint) in this change's own artifacts instead.

## Capabilities

### Modified Capabilities

- `cli-dispatch`: while a delegation is active, permission prompts that would otherwise block delegate tool calls SHALL be resolved automatically (or, if not resolvable via a hook, SHALL surface a clear message rather than a silent failure) — see spec delta.

## Non-Goals

- Building a per-write-request interactive approval bridge to the delegate CLIs themselves (the user's option B in its original, heavier form: making `claude`/`codex` pause mid-run for external approval). Neither CLI's `--help` exposes a callback/approval-hook flag in headless mode (`claude -p` only has `--permission-mode` presets; `codex exec` only has `sandbox_mode` presets and a blanket `--dangerously-bypass-approvals-and-sandbox`). Revisit only if a future CLI version adds a real per-call approval hook.
- Changing the delegate CLIs' own spawn args/config (`cli-dispatch.config.json` is already correct and live-verified).

## Impact

- `src/hooks.ts` — likely new `permission.ask` hook and/or agent-caching via `chat.message`
- `src/session-store.ts` — possibly extend with per-session agent cache if `chat.message`'s `agent` field is needed
- `src/index.ts` — wire the new hook into the plugin's `Hooks` object
- `.opencode/plugin/cli-dispatch.ts` — no change expected (already re-exports `src/index.ts`)
- Tests: unit tests for the new hook's auto-allow/skip logic
- Manual verification: reproduce the plan-agent scenario live (start a delegation, switch to a restrictive agent, confirm the fix resolves or clearly explains the block)
