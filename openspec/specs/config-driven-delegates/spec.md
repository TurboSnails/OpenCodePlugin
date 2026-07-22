# config-driven-delegates Specification

## Purpose

Configuration-driven delegate registration via a JSON config file (`cli-dispatch.config.json`), so new CLI delegates can be added without modifying plugin source code.

## Requirements

### Requirement: Load delegate configuration from JSON file
The system SHALL read delegate definitions from `cli-dispatch.config.json` in the project root or `.opencode/` directory.

#### Scenario: Config file exists
- **WHEN** the plugin starts and `cli-dispatch.config.json` exists
- **THEN** the system loads delegate definitions from the config file

#### Scenario: Config file missing
- **WHEN** the plugin starts and no config file exists
- **THEN** the system uses default delegates (claude, codex) with built-in configurations

### Requirement: Delegate configuration schema
Each delegate definition SHALL specify: `binary` (CLI executable name), `parser` (parser type: "claude", "codex", or "raw"), `startArgs` (array of arguments for starting a session), and `replyArgs` (array of arguments for continuing a session).

#### Scenario: Valid config with custom delegate
- **WHEN** config contains `{"delegates": {"my-agent": {"binary": "my-agent", "parser": "raw", "startArgs": ["--json", "--", "{prompt}"], "replyArgs": ["--resume", "{externalId}", "--", "{prompt}"]}}}`
- **THEN** the system registers `my-agent_start` and `my-agent_reply` tools

#### Scenario: Invalid config missing required field
- **WHEN** config contains a delegate missing the `binary` field
- **THEN** the system fails with an error message naming the delegate and the missing field

#### Scenario: Invalid delegate name
- **WHEN** config defines a delegate whose name does not match `/^[\w-]+$/`
- **THEN** the system fails with an error message explaining the name would produce invalid tool names

#### Scenario: startArgs missing the prompt placeholder
- **WHEN** config defines a delegate whose `startArgs` does not contain `{prompt}`
- **THEN** the system fails with an error message naming the delegate and the `startArgs` field

#### Scenario: replyArgs missing the externalId placeholder
- **WHEN** config defines a delegate whose `replyArgs` does not contain `{externalId}`
- **THEN** the system logs a warning that replies cannot resume a session, but still loads the delegate

### Requirement: Degraded plugin behavior on broken config
When the config file exists but fails to parse or validate, the plugin SHALL register a single `cli_dispatch_status` diagnostic tool instead of registering zero tools silently.

#### Scenario: Broken config registers diagnostic tool
- **WHEN** the plugin starts and the config file is invalid
- **THEN** the system registers only the `cli_dispatch_status` tool and logs the load error to the console

#### Scenario: Diagnostic tool reports the failure
- **WHEN** a user or model calls `cli_dispatch_status`
- **THEN** the tool returns the config file path, the list of validation errors, and instructions for fixing the config and reloading the plugin

### Requirement: Template variable substitution in args
The system SHALL replace `{prompt}`, `{sessionId}`, and `{externalId}` placeholders in argument arrays with actual values at runtime.

#### Scenario: Start args with sessionId
- **WHEN** starting a delegate with `startArgs: ["--session-id", "{sessionId}", "--", "{prompt}"]`
- **THEN** the system replaces `{sessionId}` with a new UUID and `{prompt}` with the user's input

#### Scenario: Reply args with externalId
- **WHEN** replying to a delegate with `replyArgs: ["--resume", "{externalId}", "--", "{prompt}"]`
- **THEN** the system replaces `{externalId}` with the stored session ID and `{prompt}` with the user's input

### Requirement: Dynamic tool registration from config
The system SHALL dynamically create `{name}_start` and `{name}_reply` tools for each delegate defined in the config.

#### Scenario: Multiple delegates in config
- **WHEN** config defines delegates "claude", "codex", and "my-agent"
- **THEN** the system registers tools: `claude_start`, `claude_reply`, `codex_start`, `codex_reply`, `my-agent_start`, `my-agent_reply`

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

### Requirement: Optional verified-models allow-list in config
The top-level configuration SHALL support an optional `verifiedModels` field: an array of strings in `providerID/modelID` form, each segment optionally ending in a trailing `*` wildcard (e.g. `anthropic/*`, `*/kimi-for-coding-k3`), matched case-sensitively. When absent or empty, no model-based restriction applies. When present with invalid entries (not a string, or not matching the `provider/model` shape), the system SHALL fail with an error message naming the invalid entry.

#### Scenario: Config without verifiedModels is valid
- **WHEN** `cli-dispatch.config.json` does not contain a `verifiedModels` field
- **THEN** the system loads the config successfully and applies no model-based restriction

#### Scenario: Config with a valid verifiedModels list
- **WHEN** `cli-dispatch.config.json` contains `"verifiedModels": ["anthropic/*", "moonshotai/kimi-for-coding-k3"]`
- **THEN** the system loads the config successfully and matches session models against these two entries

#### Scenario: Invalid verifiedModels entry is rejected
- **WHEN** `cli-dispatch.config.json` contains a `verifiedModels` entry that is not a string or does not match the `provider/model` shape
- **THEN** the system fails to load the config with an error message naming the invalid entry
