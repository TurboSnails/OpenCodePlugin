## MODIFIED Requirements

### Requirement: Sticky multi-turn delegation
Once a delegate has been addressed via `/<delegate-name>`, the system SHOULD route subsequent user messages in that opencode session to the same delegate's session (continuing its thread/session id) on a best-effort basis, without requiring the user to repeat the command, until a different delegate command is issued or delegation is exited. Sticky routing depends on the model following the injected routing rule; a model that answers a follow-up with plain text instead of calling the delegate's reply tool is outside the plugin's control to prevent — no hook can force a tool call. The system SHALL detect this after the fact, once the model's turn ends, and SHALL disconnect the delegation and post a visible notice rather than leaving it silently active; an explicit `/<delegate-name> <message>` command remains the reliable way to send a message to a delegate, including to resume after such a disconnect. The routing rule SHALL be injected at system-prompt level on every model call while a delegation is active (via the plugin's `experimental.chat.system.transform` hook keyed by opencode session id), so that intervening non-delegate commands do not terminate the delegation. While a delegation is active, command invocations (e.g. `/opsx-explore`) and agent mentions (e.g. `@explore`) SHALL be forwarded to the delegate as prompt content rather than handled by opencode's own model; opencode-internal agent-mention expansion text SHALL be rewritten to a plain-language statement of intent before forwarding.

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

#### Scenario: Model answering directly is detected and disconnects the delegation
- **WHEN** a delegation is active and the model's turn ends (`session.idle`) without having called any configured delegate's `{name}_start` or `{name}_reply` tool
- **THEN** the system clears the active delegation for that session and posts a visible, non-generating notice explaining that sticky delegation was disconnected because the model answered directly, naming the `/<delegate-name>` command needed to resume

#### Scenario: Switching to a different delegate's tool is not a violation
- **WHEN** a delegation is active for one delegate and the model's turn calls a different configured delegate's `{name}_start` or `{name}_reply` tool (per the "Switching delegates" scenario)
- **THEN** this counts as compliant, and the delegation is not disconnected

#### Scenario: User-aborted turn is not a violation
- **WHEN** a delegation is active and the user aborts the model's turn before it calls any tool
- **THEN** the system SHALL NOT treat this as a routing violation and SHALL NOT disconnect the delegation, distinguishing a user-initiated abort from the model silently choosing not to call the delegate tool
