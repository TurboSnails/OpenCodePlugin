# claude-code-host-adapter Specification

## Purpose

Claude Code acting as a delegation host: an MCP server registers `codex_start`/`codex_reply` and `opencode_start`/`opencode_reply` tools, and `PreToolUse`/`UserPromptSubmit` hooks provide the prompt-sanitization, sticky-routing, verified-models gate, and `/cc` exit command — the same contract as the OpenCode `cli-dispatch` capability, implemented on Claude Code's extensibility primitives.

## Requirements

### Requirement: Delegate a Claude Code conversation to codex or opencode
The system SHALL register `codex_start`/`codex_reply` and `opencode_start`/`opencode_reply` tools (via an MCP server) that let the user delegate the current Claude Code conversation to the `codex` or `opencode` CLI, headlessly, using the user's existing local authentication for that CLI.

#### Scenario: First delegation to codex
- **WHEN** the user issues the codex delegate-start command and no codex session is active yet for the current Claude Code conversation
- **THEN** the system starts a new headless `codex exec` session with the given task and returns codex's response to the user

#### Scenario: First delegation to opencode
- **WHEN** the user issues the opencode delegate-start command and no opencode session is active yet for the current Claude Code conversation
- **THEN** the system starts a new headless `opencode run --format json` session with the given task and returns opencode's response to the user

### Requirement: Sticky multi-turn delegation
Once a delegation to `codex` or `opencode` has been started, the system SHOULD route subsequent user messages in that Claude Code conversation to the same delegate's session (continuing its external session id) on a best-effort basis, without requiring the user to repeat the delegate-start command, until a different delegate command is issued or the user returns to Claude Code. Sticky routing depends on the model following the injected routing rule; a model that answers a follow-up with plain text instead of calling the delegate's reply tool is outside the adapter's control — no hook fires for that case — and an explicit delegate command remains the reliable way to send a message to a delegate.

#### Scenario: Follow-up message continues the same delegate
- **WHEN** the user has an active delegation and sends a follow-up message without reissuing the delegate-start command
- **THEN** the system continues the existing delegate's session using its stored external session id, rather than answering with Claude Code's own model

### Requirement: Return to Claude Code
The system SHALL provide a command that ends the active delegation for the current Claude Code conversation and returns to Claude Code's own model, following the same "say the host's own name to come home" convention as this repo's existing OpenCode `/opencode` command. The exact command name is a project decision to be confirmed before implementation.

#### Scenario: Returning to Claude Code exits the active delegation
- **WHEN** the user has an active delegation and issues the return-to-Claude-Code command
- **THEN** the system clears the conversation's delegation state and subsequent messages are answered by Claude Code's own model again

#### Scenario: Returning to Claude Code with no active delegation is a safe no-op
- **WHEN** the user issues the return-to-Claude-Code command and no delegation is active
- **THEN** no state changes occur and the system informs the user that no delegation was active

### Requirement: Model-based gate before a delegation starts
The system SHALL support the same optional `verifiedModels` allow-list behavior as the OpenCode adapter: when configured and non-empty, a delegate-start command SHALL be blocked, before any delegate tool is invoked, if the Claude Code conversation's current model does not match any allow-list entry. When the current model is not yet known to the system, or `verifiedModels` is not configured, the command SHALL proceed unrestricted (fail open).

#### Scenario: Unverified model is blocked before delegation starts
- **WHEN** `verifiedModels` is configured and non-empty, the conversation's current model matches no entry, and the user issues a delegate-start command
- **THEN** the system does not invoke the delegate tool and returns a message naming the current model instead of attempting delegation

### Requirement: Reject prompt arguments that are the whole command template
The system SHALL detect when a `prompt` argument passed to a delegate tool is the entire expanded delegate command/instruction text rather than the user's actual message, and SHALL reject the call with an actionable error instead of forwarding it to the delegate CLI.

#### Scenario: Template mistakenly forwarded as prompt is rejected
- **WHEN** a model calls a delegate tool with a `prompt` argument containing the whole forwarded command template
- **THEN** the system rejects the call with an error explaining the mistake, and does not spawn the delegate CLI

### Requirement: Delegation state persists across separate hook invocations
Unlike the OpenCode adapter (a single long-lived plugin process), Claude Code's hooks execute as separate short-lived process invocations per event. The system SHALL persist delegation state (active delegate, external session id) so that it is correctly read and updated across these separate invocations within the same Claude Code conversation, without relying on shared in-process memory. The current model (used by the model-based gate) is not part of this persisted state — it is read fresh from the conversation's own transcript on each check.

#### Scenario: State survives across hook invocations
- **WHEN** a delegation is started in one hook invocation and a follow-up message is handled by a later, separate hook invocation within the same Claude Code conversation
- **THEN** the later invocation observes the delegation state set by the earlier one
