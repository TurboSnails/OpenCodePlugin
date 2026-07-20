## 1. Package Setup

- [x] 1.1 Create `package.json` with name `opencode-cli-dispatch`, dependencies, and build scripts
- [x] 1.2 Create `tsconfig.json` for TypeScript compilation
- [x] 1.3 Create default `cli-dispatch.config.json` with claude and codex delegates

## 2. Config Loading

- [x] 2.1 Create `src/config.ts` to read and validate `cli-dispatch.config.json`
- [x] 2.2 Define `DelegateConfig` interface matching the schema (binary, parser, startArgs, replyArgs)
- [x] 2.3 Add config file lookup logic (project root, then `.opencode/`, then defaults)

## 3. Dynamic Tool Generation

- [x] 3.1 Refactor `session-store.ts` to use `string` instead of hardcoded `DelegateName` type
- [x] 3.2 Update `delegate-tools.ts` to accept `DelegateConfig[]` and generate tools dynamically
- [x] 3.3 Add template variable substitution (`{prompt}`, `{sessionId}`, `{externalId}`) in arg arrays

## 4. Parser Updates

- [x] 4.1 Refactor `parse-events.ts` to export a `getParser(name)` function returning the appropriate parser
- [x] 4.2 Add `raw` parser that captures all stdout as final text
- [x] 4.3 Update `run-delegate.ts` to use parser from config instead of hardcoded function

## 5. Routing and Hooks

- [x] 5.1 Update `routing-rule.ts` to accept any delegate name (remove hardcoded references)
- [x] 5.2 Update `hooks.ts` to read active delegate from session store (already dynamic)
- [x] 5.3 Update `makeSystemTransform` to work with any delegate name

## 6. Command Generation

- [x] 6.1 Create command template with placeholder for delegate name
- [x] 6.2 Add logic to generate `/cc`, `/codex`, and custom delegate commands from config
- [x] 6.3 Ensure `/opencode` command works with any active delegate

## 7. Plugin Entry Point

- [x] 7.1 Update `index.ts` to load config and pass to tool/hook generators
- [x] 7.2 Wire up all components: config → tools → hooks → commands
- [x] 7.3 Add error handling for config load failures

## 8. Testing

- [x] 8.1 Add unit tests for config loading and validation
- [x] 8.2 Add unit tests for template variable substitution
- [x] 8.3 Add unit tests for dynamic tool generation
- [x] 8.4 Add integration test with a mock delegate CLI
