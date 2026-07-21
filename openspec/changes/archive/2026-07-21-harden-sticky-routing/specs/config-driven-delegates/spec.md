## ADDED Requirements

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
