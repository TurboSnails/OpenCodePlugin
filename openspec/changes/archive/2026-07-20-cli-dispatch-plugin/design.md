## Context

The CLI dispatch plugin currently lives in `.opencode/` as a local project plugin. It hardcodes two delegates (Claude and Codex) with fixed argument builders and parsers. The goal is to make this configurable and packageable as an npm module for reuse across projects.

Current architecture:
- `delegates.ts`: Hardcoded `buildCodexStartArgs`, `buildClaudeStartArgs`, etc.
- `delegate-tools.ts`: `DELEGATES` record with fixed entries
- `session-store.ts`: `DelegateName` type is `"codex" | "claude"`
- `parse-events.ts`: `parseCodexLine`, `parseClaudeLine` functions
- Commands: `/cc`, `/codex`, `/opencode` in `.opencode/command/`

## Goals / Non-Goals

**Goals:**
- Delegates defined in JSON config, not code
- Add new CLIs without modifying source
- Package as `opencode-cli-dispatch` npm module
- Keep existing behavior for Claude and Codex as defaults
- Support `raw` parser for unknown CLIs

**Non-Goals:**
- GUI for config editing
- Hot-reload of config
- Support for non-Bun runtimes
- OpenSpec integration (separate concern)

## Decisions

### Decision 1: Config file location

**Choice**: `.opencode/cli-dispatch.config.json` (project-level)

**Rationale**: Keeps config with the project. Global config can be added later if needed. Simpler than requiring environment variables or complex lookup.

**Alternatives considered**:
- Global config only (`~/.config/opencode/`): Rejected because different projects may need different delegates
- Environment variables: Rejected for UX complexity

### Decision 2: Template variables in args

**Choice**: Use `{prompt}`, `{sessionId}`, `{externalId}` placeholders in arg arrays

**Rationale**: Simple string replacement. Covers all current use cases. No need for complex templating.

Example:
```json
{
  "startArgs": ["--session-id", "{sessionId}", "--", "{prompt}"],
  "replyArgs": ["--resume", "{externalId}", "--", "{prompt}"]
}
```

### Decision 3: Parser strategy

**Choice**: Three built-in parsers: `claude`, `codex`, `raw`

**Rationale**:
- `claude`: Parses Claude Code's `stream-json` output (type: "assistant", "result")
- `codex`: Parses Codex's JSONL events (thread.started, item.completed, etc.)
- `raw`: Captures all stdout as final text (fallback for unknown CLIs)

**Alternatives considered**:
- JSONPath/JSONata expressions: Rejected as overkill for this use case
- Custom JS functions: Rejected for security and complexity

### Decision 4: Command generation

**Choice**: Template-based generation from delegate names

**Rationale**: Commands `/cc`, `/codex`, `/opencode` follow the same pattern. Only the delegate name changes. Can be generated at plugin init time.

**Implementation**: Read config, for each delegate create `{name}_start` and `{name}_reply` tools. Generate command markdown from template with delegate name substitution.

### Decision 5: Package structure

**Choice**: Single npm package with `src/` directory

```
opencode-cli-dispatch/
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts
│   ├── config.ts
│   ├── delegate-tools.ts
│   ├── run-delegate.ts
│   ├── session-store.ts
│   ├── routing-rule.ts
│   ├── parse-events.ts
│   └── hooks.ts
├── commands/
│   ├── cc.md
│   ├── codex.md
│   └── opencode.md
└── cli-dispatch.config.json  (default config)
```

**Rationale**: Standard npm structure. `src/` for source, `commands/` for command templates.

## Risks / Trade-offs

**[Risk] Config parsing errors** → Fail fast with clear error message on startup

**[Risk] Unknown CLI output format** → `raw` parser provides fallback; users can add custom parsers later

**[Risk] Breaking existing behavior** → Keep defaults for claude/codex; config is additive

**[Trade-off] Simplicity vs flexibility** → Chose simplicity (built-in parsers) over full flexibility (custom parser functions). Can extend later if needed.
