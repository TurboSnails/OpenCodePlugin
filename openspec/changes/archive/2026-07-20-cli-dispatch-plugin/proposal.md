## Why

The CLI dispatch plugin is hardcoded to only support Claude and Codex as delegates. To share this tool with colleagues, we need to make it configurable so new CLIs can be added via a JSON config file without modifying source code. This turns a personal tool into a reusable package.

## What Changes

- Add `cli-dispatch.config.json` configuration file to define delegates (binary, args, parser)
- Replace hardcoded `DelegateName` type with dynamic names read from config
- Add built-in parsers: `claude`, `codex`, and `raw` (fallback for unknown CLIs)
- Make commands (`/cc`, `/codex`, `/opencode`) template-based, generated from delegate names
- Package as an installable npm package (`opencode-cli-dispatch`)

## Capabilities

### New Capabilities
- `config-driven-delegates`: Configuration-driven delegate registration via JSON config file

### Modified Capabilities
- `cli-dispatch`: Existing capability modified to support dynamic delegate names from config instead of hardcoded values

## Impact

- Files in `.opencode/lib/cli-dispatch/`: `delegates.ts`, `delegate-tools.ts`, `session-store.ts`, `hooks.ts`
- New file: `src/config.ts` for config loading
- Package structure: Add `package.json`, `tsconfig.json` at project root
- Commands: Template-based generation from delegate names
- No breaking changes to existing behavior (claude and codex remain defaults)
