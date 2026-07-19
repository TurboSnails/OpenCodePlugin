## 1. Routing rule injection

- [ ] 1.1 Add `experimental.chat.system.transform` hook in `.opencode/plugin/cli-dispatch.ts` that checks `getActiveDelegate(sessionID)` and, when a delegation is active, appends the routing rule to `output.system` (rule names the active delegate, instructs verbatim forwarding of the latest user message — including command-injected content — to `<delegate>_reply`, and returning its output without commentary)
- [ ] 1.2 Extract the rule text into a testable builder (e.g. `buildRoutingRule(delegate)` in `.opencode/lib/cli-dispatch/`), kept short and absolute
- [ ] 1.3 Add `chat.message` hook: while a delegation is active, detect agent-mention parts and rewrite the paired opencode-internal expansion boilerplate to a plain-language statement of intent naming the agent; no-op when no mention is present or no delegation is active

## 2. Exit command

- [ ] 2.1 Create `.opencode/command/opencode.md` describing the exit (confirm resumption of opencode handling; inform when no delegation was active)
- [ ] 2.2 Add `command.execute.before` hook in the plugin: when `command === "opencode"`, record prior state, call `clearActiveDelegate(sessionID)`, and append a ground-truth note part ("cleared active <delegate> delegation" / "no delegation was active") before the model turn runs
- [ ] 2.3 Append the `/opencode` exit hint to delegate failure strings in `.opencode/lib/cli-dispatch/delegate-tools.ts` (both start and reply failure returns)

## 3. Command doc updates

- [ ] 3.1 Update `.opencode/command/cc.md` and `.opencode/command/codex.md`: document `/opencode` as the exit path and note that non-delegate commands are forwarded while delegated
- [ ] 3.2 Document the known limitations in the command docs or project docs: plan-agent permission interference with delegate tools; built-in TUI commands are unaffected by construction

## 4. Tests

- [ ] 4.1 Unit test: system.transform hook appends the routing rule only when `getActiveDelegate` returns a session for that id, and names the correct delegate
- [ ] 4.2 Unit test: command.execute.before clears state for `opencode` command, appends the correct note part for both prior-state cases, and ignores other commands / unknown sessions
- [ ] 4.3 Unit test: chat.message hook rewrites mention boilerplate only while delegated and leaves parts untouched otherwise
- [ ] 4.4 Integration verification (manual, via `opencode serve` + HTTP): `/cc` → plain follow-up → `/opsx-explore` → follow-up → `@explore` all route to claude; `/opencode` exits and next message is answered by opencode's model; `/opencode` with no delegation is a no-op

## 5. Rule wording validation

- [ ] 5.1 Run the integration sequence against a third-party provider (Kimi or MiniMax) and adjust rule wording until routing holds across the command turn
