## MODIFIED Requirements

### Requirement: Session state scoped per opencode session
The system SHALL track, per opencode session, which delegate (if any) is currently active and that delegate's own thread/session identifier, so that concurrent opencode sessions do not share or overwrite each other's delegated conversations. Capturing this identifier on `*_start` SHALL work uniformly for every configured delegate, regardless of whether that delegate's CLI assigns its own session/thread id and reports it back on the output stream, or whether opencode generates the id itself and passes it to the CLI at spawn time.

#### Scenario: Two opencode sessions delegate independently
- **WHEN** two separate opencode sessions each start a `/codex` delegation
- **THEN** each session's follow-up messages continue its own codex thread id, independent of the other session's thread

#### Scenario: Claude session id is captured on start
- **WHEN** the user sends `/claude <task>` and no claude session exists yet for the current opencode session
- **THEN** the system registers the claude session as active for that opencode session using the session id passed to the claude CLI at spawn time, so that a subsequent follow-up message successfully continues the same claude session instead of failing with "No active claude session"
