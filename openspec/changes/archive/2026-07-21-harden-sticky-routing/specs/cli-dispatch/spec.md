## ADDED Requirements

### Requirement: Model-based gate before a delegation starts
The system SHALL track, per opencode session, the model (`providerID`/`modelID`) active for that session, sourced from the `chat.message` hook's `input.model`. When a `verifiedModels` allow-list is configured (non-empty) and the user issues a delegate-start command (e.g. `/<delegate-name>`) while the session's tracked model does not match any entry in the allow-list, the system SHALL NOT call `{name}_start` and SHALL instead return a message naming the current model and pointing at the allow-list as the reason, before any model turn runs. When no model has yet been tracked for the session (e.g. this is the session's first message), the system SHALL allow the command through unrestricted (fail open). When `verifiedModels` is not configured or is empty, this requirement imposes no restriction and behavior is unchanged from before this capability existed.

#### Scenario: Verified model proceeds normally
- **WHEN** `verifiedModels` is configured, the session's tracked model matches an entry, and the user issues `/<delegate-name> <task>`
- **THEN** the system starts the delegation as usual

#### Scenario: Unverified model is blocked before delegation starts
- **WHEN** `verifiedModels` is configured and non-empty, the session's tracked model matches no entry, and the user issues `/<delegate-name> <task>`
- **THEN** the system does not call `{name}_start`, and returns a message naming the current model and stating it is not on the verified list, instead of attempting delegation

#### Scenario: No model tracked yet fails open
- **WHEN** `verifiedModels` is configured, no model has been tracked yet for the session, and the user issues `/<delegate-name> <task>`
- **THEN** the system allows the command through and starts the delegation as usual

#### Scenario: No allow-list configured imposes no restriction
- **WHEN** `verifiedModels` is not configured (or configured empty) and the user issues `/<delegate-name> <task>`
- **THEN** the system starts the delegation regardless of the session's tracked model

### Requirement: Reject prompt arguments that are the whole command template
The system SHALL detect when a `prompt` argument passed to `{name}_start` or `{name}_reply` is the entire expanded delegate command template rather than the user's actual message (identified by the presence of the generated-command marker used internally to tag generated command files), and SHALL reject the call with an actionable error instead of forwarding it to the delegate CLI.

#### Scenario: Template mistakenly forwarded as prompt is rejected
- **WHEN** a model calls `{name}_start` (or `{name}_reply`) with a `prompt` argument containing the generated-command marker
- **THEN** the system rejects the call with an error explaining that the whole command template was forwarded instead of the user's message, and does not spawn the delegate CLI

#### Scenario: Normal user prompt is unaffected
- **WHEN** a model calls `{name}_start` (or `{name}_reply`) with a `prompt` argument that is ordinary user text
- **THEN** the system spawns the delegate CLI as usual
