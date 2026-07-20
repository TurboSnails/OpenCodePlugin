## 1. Spawn Infrastructure

- [x] 1.1 Extend `SpawnFn` in `src/run-delegate.ts` with optional `cwd` option
- [x] 1.2 Add optional `timeoutMs` to `runDelegate` that kills the subprocess and rejects on timeout
- [x] 1.3 Add tests for `cwd` pass-through and timeout kill behavior (mock spawn)

## 2. Health Check

- [x] 2.1 Create `src/health-check.ts` with `checkDelegate(name, cfg, run?)`: mkdtemp → spawn with `startArgs` + minimal write prompt (cwd = temp dir) → scan temp dir for new files → return pass/fail with output excerpt and permission-config hint
- [x] 2.2 Generate `{name}_check` tool per delegate in `src/index.ts` (alongside `*_start`/`*_reply`)
- [x] 2.3 Export `checkDelegate` from `src/index.ts`
- [x] 2.4 Add tests: pass case (file appears), fail case (nothing created, hint included), timeout case, workspace-isolation case (mock spawn writing only to temp dir)

## 3. Working-Tree Change Summary

- [x] 3.1 Add git helpers in `src/delegate-tools.ts`: porcelain snapshot capture with non-git guard
- [x] 3.2 Wrap `run()` in `*_start`/`*_reply` with before/after snapshots; on delta, append `git diff --stat` + new untracked filenames, capped at ~50 lines with truncation note
- [x] 3.3 Add tests: changed files produce summary, no changes produce none, non-git directory produces none and no error

## 4. Documentation

- [x] 4.1 Add "Delegate permissions" section to package README: claude `--permission-mode` values, codex `sandbox_mode` values, writable-by-default expectation, spawn-time baking + restart-to-apply note

## 5. Verification

- [x] 5.1 Run `bun test` — all tests pass
- [x] 5.2 Run `bun run build` — TypeScript compiles cleanly
- [x] 5.3 Live smoke: `/cc` start a fresh delegation, confirm the delegate can edit a file and the tool result ends with a change summary (verified: `checkDelegate` live-passed against real claude; `makeStartTool` live run in a temp git repo edited `hello.md` and the tool result ended with `Changed during this run: new file: hello.md`; `.opencode/plugin/cli-dispatch.ts` switched to the new `src/` implementation)
