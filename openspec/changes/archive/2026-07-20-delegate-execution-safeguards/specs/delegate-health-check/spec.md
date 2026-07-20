## ADDED Requirements

### Requirement: Per-delegate health check tool
For each configured delegate, the system SHALL expose a `{name}_check` tool that verifies the delegate can write files when spawned with its configured arguments. The check SHALL spawn the delegate with its real `startArgs` in an isolated temporary directory with a minimal write instruction, and SHALL report pass when a new file appears in that directory after the run.

#### Scenario: Writable delegate passes the check
- **WHEN** the user invokes `claude_check` and the claude delegate is configured with write-capable permission flags
- **THEN** the system spawns claude in a temp directory, detects a newly created file, and reports that the delegate is writable

#### Scenario: Read-only delegate fails the check with an actionable hint
- **WHEN** the user invokes `claude_check` and the claude delegate is configured with read-only permission flags (e.g. `--permission-mode dontAsk`)
- **THEN** the system reports that the delegate could not write, includes an excerpt of the delegate's output, and points at the delegate's permission/sandbox config as the likely cause

### Requirement: Health check isolation
The health check SHALL run entirely inside a fresh temporary directory and SHALL NOT create, modify, or delete any file in the user's workspace.

#### Scenario: Workspace untouched by a passing check
- **WHEN** a health check runs to completion
- **THEN** the workspace working tree is unchanged and all check artifacts remain inside the temp directory

### Requirement: Health check timeout
The health check SHALL terminate the delegate subprocess after a bounded timeout and report failure rather than hanging indefinitely.

#### Scenario: Hung delegate is killed
- **WHEN** the delegate subprocess does not exit within the timeout
- **THEN** the system kills the subprocess and reports the check as failed due to timeout
