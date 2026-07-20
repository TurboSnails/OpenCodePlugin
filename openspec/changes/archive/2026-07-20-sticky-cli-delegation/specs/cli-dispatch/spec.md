## MODIFIED Requirements

### Requirement: Sticky multi-turn delegation
Once a delegate has been addressed via `/codex` or `/cc`, the system SHALL route subsequent user messages in that opencode session to the same delegate's session (continuing its thread/session id), without requiring the user to repeat the command, until a different delegate command is issued or delegation is exited. The routing rule SHALL be injected at system-prompt level on every model call while a delegation is active (via the plugin's `experimental.chat.system.transform` hook keyed by opencode session id), so that intervening non-delegate commands do not terminate the delegation. While a delegation is active, command invocations (e.g. `/opsx-explore`) and agent mentions (e.g. `@explore`) SHALL be forwarded to the delegate as prompt content rather than handled by opencode's own model; opencode-internal agent-mention expansion text SHALL be rewritten to a plain-language statement of intent before forwarding.

#### Scenario: Follow-up message continues the same delegate
- **WHEN** the user has an active codex delegation and sends a follow-up message without a `/codex`/`/cc` prefix
- **THEN** the system continues the existing codex thread using its stored thread id, rather than answering with opencode's own model

#### Scenario: Switching delegates takes over immediately
- **WHEN** the user has an active codex delegation and sends `/cc <task>`
- **THEN** the system starts or continues a claude delegation, and subsequent un-prefixed messages route to claude instead of codex

#### Scenario: Intervening command does not break delegation
- **WHEN** the user has an active claude delegation and issues a non-delegate command such as `/opsx-explore`, then sends a follow-up message
- **THEN** both the command content and the follow-up are routed to the active claude session, and opencode's own model does not answer directly

#### Scenario: Command content is forwarded to the delegate
- **WHEN** the user has an active claude delegation and issues `/opsx-explore <topic>`
- **THEN** the explore instructions and topic are passed to the claude session as prompt content, and claude's response is returned to the user

#### Scenario: Agent mention is translated and forwarded to the delegate
- **WHEN** the user has an active claude delegation and sends `@explore <topic>`
- **THEN** the opencode-internal mention expansion text is rewritten to a plain-language statement of intent, the rewritten content is passed to the claude session, and claude's response is returned to the user

## ADDED Requirements

### Requirement: Exit delegation back to opencode
The system SHALL provide an `/opencode` command that ends the active delegation for the current opencode session. The exit SHALL be performed deterministically by the plugin (clearing the session's delegation state in `command.execute.before`, before any model call), not by relying on the model to invoke a tool. After exit, subsequent messages SHALL be handled by opencode's own agent again.

#### Scenario: Exiting an active delegation
- **WHEN** the user has an active claude delegation and issues `/opencode`
- **THEN** the plugin clears the session's delegation state before the model turn runs, and the next un-prefixed message is answered by opencode's own model

#### Scenario: Exit without active delegation is a safe no-op
- **WHEN** the user issues `/opencode` and no delegation is active for the session
- **THEN** no state changes occur and the system informs the user that no delegation was active

#### Scenario: Exit is final and the next delegation starts fresh
- **WHEN** the user exits a claude delegation with `/opencode` and later issues `/cc` again
- **THEN** a new delegation is established for the session and the prior external CLI session id is not reused

### Requirement: Delegate failure guidance
When a delegate invocation fails, the system SHALL preserve the session's delegation state and SHALL include in the returned error text a hint that the user can exit delegation with `/opencode`.

#### Scenario: Failure keeps state and hints at the exit
- **WHEN** the user has an active claude delegation and a `claude_reply` invocation fails (delegate CLI error, missing binary, or expired auth)
- **THEN** the delegation state is preserved for the session, and the error text returned to the user includes a hint to use `/opencode` to exit delegation
