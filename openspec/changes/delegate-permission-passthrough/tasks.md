## 1. Spike: identify the actual chokepoint

- [x] 1.1 Start a delegation (`/cc` or `/codex`), switch to a restrictive agent (plan agent first), attempt a follow-up that should route to `*_reply`, and capture the exact failure the user sees — partial: fresh `claude_start` under `plan` agent succeeded (no block); the sticky follow-up (`claude_reply`) path could not be exercised via `opencode run` because its in-memory session-store doesn't survive across the ephemeral per-invocation server process. See design.md "Spike results".
- [x] 1.2 Cross-reference `~/.local/share/opencode/log/opencode.log` for the same time window — no `permission.ask`/deny event appeared around the (successful) `claude_start` call; nothing to cross-reference for the untested sticky path.
- [x] 1.3 If ambiguous, add temporary debug logging to a throwaway `permission.ask` hook to confirm whether it fires for this session/tool at all — done via a persistent `opencode serve` session (2026-07-20): 3 real tool calls (2x `claude_start`, 1x `claude_reply`) under `plan` agent, zero `permission.ask` events logged. See design.md "Spike results, part 2".
- [x] 1.4 Record the finding in design.md (resolve the M1 vs M2 open question) before starting implementation — done: **M2 confirmed**. `permission.ask` never fires for custom plugin tools; agent restrictions are system-prompt-enforced, not permission-event-mediated. M1 dropped as a no-op path.

## 2a. If M1 (permission.ask is the chokepoint) — SKIPPED, M2 confirmed instead (see 1.3/1.4)

- [ ] ~~2a.1 Add `makePermissionAsk()` in `src/hooks.ts`...~~ not applicable
- [ ] ~~2a.2 Wire it into `src/index.ts`...~~ not applicable
- [ ] ~~2a.3 Unit test...~~ not applicable
- [ ] ~~2a.4 Live verification...~~ not applicable

## 2b. If M2 (tool-availability filtering, no interceptable event)

- [ ] 2b.1 Add a per-session agent cache in `src/session-store.ts` (or a small adjacent module), populated from `chat.message`'s `input.agent`
- [ ] 2b.2 On `*_reply` failure caused by tool unavailability (or proactively, before the call), check the cached agent against a known-restrictive set and return an explicit message pointing at `/opencode` to exit or switch agents, instead of a silent/confusing error
- [ ] 2b.3 Unit test: agent cache updates on `chat.message`, explicit message includes the offending agent name and the `/opencode` hint
- [ ] 2b.4 Live verification: reproduce the task 1 scenario again, confirm the user now gets an actionable message

## 3. Documentation

- [ ] 3.1 Update `sticky-cli-delegation`'s known limitation (now superseded) — note resolution or confirmed remaining constraint in this change's own spec delta and in command docs if user-facing behavior changed
- [ ] 3.2 If M2 path taken, document which agents are known-restrictive and why (plan agent confirmed; others TBD)

## 4. Verification

- [ ] 4.1 `bun test` passes
- [ ] 4.2 `bun run build` compiles cleanly
