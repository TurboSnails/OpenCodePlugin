## MODIFIED Requirements

### Requirement: Built-in parser selection
The system SHALL use the specified parser for each delegate: "claude" for Claude Code stream-json, "codex" for Codex JSONL events, "opencode" for `opencode run --format json` events, or "raw" for stdout capture.

#### Scenario: Claude parser
- **WHEN** delegate uses parser "claude"
- **THEN** the system parses JSON lines with `type: "assistant"` for progress and `type: "result"` for final text

#### Scenario: Codex parser
- **WHEN** delegate uses parser "codex"
- **THEN** the system parses JSON lines with `type: "thread.started"` for session ID and `type: "item.completed"` with `item.type: "agent_message"` for final text

#### Scenario: Opencode parser
- **WHEN** delegate uses parser "opencode"
- **THEN** the system parses JSON lines with a `sessionID` field (present on every line) for the external session id, and accumulates `type: "text"` events' `part.text` (in order, newline-joined) as the final text

#### Scenario: Raw parser
- **WHEN** delegate uses parser "raw"
- **THEN** the system captures all stdout lines and concatenates them (joined with newlines, in order) as the final text
