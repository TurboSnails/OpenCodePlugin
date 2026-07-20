# cli-dispatch Specification

## Purpose

An opencode plugin and set of commands (`/codex`, `/cc`) that delegate the current conversation to codex or claude's own CLI agent loop via a headless subprocess, with sticky multi-turn routing, live progress reporting parsed from the CLI's streaming output, and per-session delegation state.

## Requirements

### Requirement: Delegate a conversation to an external CLI
The system SHALL let the user start delegating the current opencode conversation to any configured CLI agent by issuing a command matching the delegate name (e.g., `/claude`, `/codex`, `/my-agent`). Starting delegation SHALL spawn the corresponding CLI in headless mode using the user's existing local authentication for that CLI, without requiring any additional API key configuration.

#### Scenario: First delegation to a configured CLI
- **WHEN** the user sends `/<delegate-name> <task>` and no session exists yet for that delegate in the current opencode session
- **THEN** the system starts a new headless session with the given task using the delegate's configured binary and args, and returns the delegate's response to the user

#### Scenario: Unknown delegate command
- **WHEN** the user sends `/<unknown-name> <task>` and no delegate with that name is configured
- **THEN** the system responds with an error indicating the delegate is not configured

### Requirement: Sticky multi-turn delegation
Once a delegate has been addressed via `/<delegate-name>`, the system SHALL route subsequent user messages in that opencode session to the same delegate's session (continuing its thread/session id), without requiring the user to repeat the command, until a different delegate command is issued or delegation is exited. The routing rule SHALL be injected at system-prompt level on every model call while a delegation is active (via the plugin's `experimental.chat.system.transform` hook keyed by opencode session id), so that intervening non-delegate commands do not terminate the delegation. While a delegation is active, command invocations (e.g. `/opsx-explore`) and agent mentions (e.g. `@explore`) SHALL be forwarded to the delegate as prompt content rather than handled by opencode's own model; opencode-internal agent-mention expansion text SHALL be rewritten to a plain-language statement of intent before forwarding.

#### Scenario: Follow-up message continues the same delegate
- **WHEN** the user has an active delegation and sends a follow-up message without a `/<delegate-name>` prefix
- **THEN** the system continues the existing delegate's thread using its stored session id, rather than answering with opencode's own model

#### Scenario: Switching delegates takes over immediately
- **WHEN** the user has an active codex delegation and sends `/claude <task>`
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

### Requirement: Live progress while a delegate is running
While a delegated CLI subprocess is running, the system SHALL surface live progress information in opencode's UI by parsing the CLI's streaming JSON output, rather than only showing a result once the subprocess exits.

#### Scenario: Progress visible during a long-running codex task
- **WHEN** a codex delegation is running a multi-step task
- **THEN** the system updates opencode's UI with progress information parsed from codex's JSONL event stream before the task completes

### Requirement: Delegate run timeout and cancellation
Every delegate CLI run SHALL be bounded by a timeout: 10 minutes by default, overridable per delegate via an optional `timeoutMs` field (in milliseconds) in the delegate configuration. A `timeoutMs` value that is not a positive number SHALL be rejected as an invalid config. When the timeout fires, the system SHALL terminate the subprocess with SIGTERM and, if it has not exited after a short grace period, SHALL escalate to SIGKILL; the resulting error SHALL state clearly that the run timed out. When the user cancels an in-flight delegate tool call (via opencode's abort signal), the system SHALL terminate the subprocess the same way and SHALL report the failure as cancelled by the user, distinguishable from both a timeout and a subprocess crash.

#### Scenario: Timeout terminates a hung delegate CLI
- **WHEN** a delegate CLI run exceeds its configured timeout
- **THEN** the system sends SIGTERM to the subprocess, escalates to SIGKILL after the grace period if the process is still running, and the tool result states that the run timed out

#### Scenario: Delegate config overrides the default timeout
- **WHEN** a delegate's config sets `timeoutMs` to a positive number
- **THEN** that value bounds the delegate's runs instead of the 10-minute default

#### Scenario: Invalid timeoutMs is rejected
- **WHEN** a delegate's config contains a `timeoutMs` that is not a positive number
- **THEN** loading the config fails with an invalid-config error naming the delegate

#### Scenario: User cancellation kills the delegate subprocess
- **WHEN** the user aborts an in-flight `*_start` or `*_reply` tool call
- **THEN** the system terminates the delegate subprocess (SIGTERM, escalating to SIGKILL after the grace period) and the tool result indicates the run was cancelled by the user, rather than a timeout or a crash

### Requirement: Session state scoped per opencode session
The system SHALL track, per opencode session, which delegate (if any) is currently active and that delegate's own thread/session identifier, so that concurrent opencode sessions do not share or overwrite each other's delegated conversations. Capturing this identifier on `*_start` SHALL work uniformly for every configured delegate, regardless of whether that delegate's CLI assigns its own session/thread id and reports it back on the output stream, or whether opencode generates the id itself and passes it to the CLI at spawn time.

#### Scenario: Two opencode sessions delegate independently
- **WHEN** two separate opencode sessions each start a `/codex` delegation
- **THEN** each session's follow-up messages continue its own codex thread id, independent of the other session's thread

#### Scenario: Latest initiated concurrent start wins
- **WHEN** two `*_start` runs race in the same opencode session and the later-initiated start completes before the earlier one
- **THEN** the session's active delegation is the one from the latest initiated start, and the earlier start's later completion does not overwrite it

#### Scenario: Claude session id is captured on start
- **WHEN** the user sends `/claude <task>` and no claude session exists yet for the current opencode session
- **THEN** the system registers the claude session as active for that opencode session using the session id passed to the claude CLI at spawn time, so that a subsequent follow-up message successfully continues the same claude session instead of failing with "No active claude session"

### Requirement: Working-tree change summary in tool results
After a `*_start` or `*_reply` delegation run completes, the system SHALL compare the git working tree before and after the run and, when files changed during the run, SHALL append a change summary to the tool result. The summary SHALL include `git diff --stat` output for tracked changes and the names of newly created untracked files.

#### Scenario: Delegate edits are visible to the host
- **WHEN** a delegation run modifies `src/config.ts` and creates `notes.md`
- **THEN** the tool result ends with a change summary listing the modification stat for `src/config.ts` and the new file `notes.md`

#### Scenario: No changes, no summary
- **WHEN** a delegation run completes without altering the working tree
- **THEN** the tool result contains no change summary section

#### Scenario: Non-git workspace
- **WHEN** a delegation run completes in a directory that is not a git repository
- **THEN** the tool result contains no change summary and no error is raised

#### Scenario: Delegate subprocess and change summary use the session project directory
- **WHEN** a `*_start` or `*_reply` delegation runs and the session's project directory (from the tool context) differs from the plugin process's working directory
- **THEN** the delegate subprocess runs with the session's project directory as its working directory, and the before/after working-tree comparison is performed in that same directory; when the tool context provides no directory, both fall back to the plugin process's working directory

### Requirement: Delegate permission documentation
The package documentation SHALL describe the permission/sandbox flags of each built-in delegate, state that delegates are expected to be configured with write capability, and state that permission flags are baked into a delegate session at spawn time so config changes require restarting the delegation to take effect.

#### Scenario: User diagnoses a read-only delegate from the docs
- **WHEN** a user's delegate cannot edit files and they consult the package documentation
- **THEN** the documentation explains which flag controls write capability for that delegate and that restarting the delegation applies config changes

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

### Requirement: Permission passthrough during active delegation
While a session has an active delegation, opencode-side permission prompts that would otherwise block a delegate tool call (`*_start`/`*_reply`) SHALL either be resolved automatically without prompting the user, or, where no interceptable permission event exists, SHALL surface an explicit message identifying the blocking cause (e.g. the active agent) and pointing at `/opencode` as the way to recover — rather than a silent or confusing failure.

#### Scenario: Permission ask is auto-resolved during active delegation
- **WHEN** a session has an active claude delegation and an opencode `permission.ask` event fires for that session while a delegate tool call is in flight
- **THEN** the system resolves the permission as allowed without prompting the user

#### Scenario: Non-interceptable block surfaces an explicit message
- **WHEN** a session has an active delegation, the current agent restricts delegate tool availability, and no permission event is emitted for the plugin to intercept
- **THEN** the system returns a message naming the restrictive agent as the cause and instructs the user to switch agents or use `/opencode` to exit delegation, instead of a silent failure

#### Scenario: No active delegation, default permission behavior is unchanged
- **WHEN** a session has no active delegation
- **THEN** permission prompts are handled by opencode's existing default behavior, unmodified by this plugin
