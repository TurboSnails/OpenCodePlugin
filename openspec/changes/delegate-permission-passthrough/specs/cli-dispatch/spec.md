## ADDED Requirements

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
