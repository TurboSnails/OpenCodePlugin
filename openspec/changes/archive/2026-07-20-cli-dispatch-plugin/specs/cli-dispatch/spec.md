## MODIFIED Requirements

### Requirement: Delegate a conversation to an external CLI
The system SHALL let the user start delegating the current opencode conversation to any configured CLI agent by issuing a command matching the delegate name (e.g., `/claude`, `/codex`, `/my-agent`). Starting delegation SHALL spawn the corresponding CLI in headless mode using the user's existing local authentication for that CLI, without requiring any additional API key configuration.

#### Scenario: First delegation to a configured CLI
- **WHEN** the user sends `/<delegate-name> <task>` and no session exists yet for that delegate in the current opencode session
- **THEN** the system starts a new headless session with the given task using the delegate's configured binary and args, and returns the delegate's response to the user

#### Scenario: Unknown delegate command
- **WHEN** the user sends `/<unknown-name> <task>` and no delegate with that name is configured
- **THEN** the system responds with an error indicating the delegate is not configured

### Requirement: Sticky multi-turn delegation
Once a delegate has been addressed via `/<delegate-name>`, the system SHALL route subsequent user messages in that opencode session to the same delegate's session (continuing its thread/session id), without requiring the user to repeat the command, until a different delegate command is issued.

#### Scenario: Follow-up message continues the same delegate
- **WHEN** the user has an active delegation and sends a follow-up message without a `/<delegate-name>` prefix
- **THEN** the system continues the existing delegate's thread using its stored session id, rather than answering with opencode's own model

#### Scenario: Switching delegates takes over immediately
- **WHEN** the user has an active codex delegation and sends `/claude <task>`
- **THEN** the system starts or continues a claude delegation, and subsequent un-prefixed messages route to claude instead of codex
