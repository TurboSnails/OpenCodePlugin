## ADDED Requirements

### Requirement: Delegate a conversation to an external CLI
The system SHALL let the user start delegating the current opencode conversation to codex or claude's own CLI agent by issuing `/codex` or `/cc` respectively. Starting delegation SHALL spawn the corresponding CLI in headless mode using the user's existing local authentication for that CLI, without requiring any additional API key configuration.

#### Scenario: First delegation to codex
- **WHEN** the user sends `/codex <task>` and no codex thread exists yet for the current opencode session
- **THEN** the system starts a new codex headless session with the given task and returns codex's response to the user

#### Scenario: Delegating to claude
- **WHEN** the user sends `/cc <task>`
- **THEN** the system starts a new claude headless session (`claude -p`) with the given task, reusing the user's existing Claude Code authentication

### Requirement: Sticky multi-turn delegation
Once a delegate has been addressed via `/codex` or `/cc`, the system SHALL route subsequent user messages in that opencode session to the same delegate's session (continuing its thread/session id), without requiring the user to repeat the command, until a different delegate command is issued.

#### Scenario: Follow-up message continues the same delegate
- **WHEN** the user has an active codex delegation and sends a follow-up message without a `/codex`/`/cc` prefix
- **THEN** the system continues the existing codex thread using its stored thread id, rather than answering with opencode's own model

#### Scenario: Switching delegates takes over immediately
- **WHEN** the user has an active codex delegation and sends `/cc <task>`
- **THEN** the system starts or continues a claude delegation, and subsequent un-prefixed messages route to claude instead of codex

### Requirement: Live progress while a delegate is running
While a delegated CLI subprocess is running, the system SHALL surface live progress information in opencode's UI by parsing the CLI's streaming JSON output, rather than only showing a result once the subprocess exits.

#### Scenario: Progress visible during a long-running codex task
- **WHEN** a codex delegation is running a multi-step task
- **THEN** the system updates opencode's UI with progress information parsed from codex's JSONL event stream before the task completes

### Requirement: Session state scoped per opencode session
The system SHALL track, per opencode session, which delegate (if any) is currently active and that delegate's own thread/session identifier, so that concurrent opencode sessions do not share or overwrite each other's delegated conversations.

#### Scenario: Two opencode sessions delegate independently
- **WHEN** two separate opencode sessions each start a `/codex` delegation
- **THEN** each session's follow-up messages continue its own codex thread id, independent of the other session's thread
