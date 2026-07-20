## ADDED Requirements

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

### Requirement: Delegate permission documentation
The package documentation SHALL describe the permission/sandbox flags of each built-in delegate, state that delegates are expected to be configured with write capability, and state that permission flags are baked into a delegate session at spawn time so config changes require restarting the delegation to take effect.

#### Scenario: User diagnoses a read-only delegate from the docs
- **WHEN** a user's delegate cannot edit files and they consult the package documentation
- **THEN** the documentation explains which flag controls write capability for that delegate and that restarting the delegation applies config changes
