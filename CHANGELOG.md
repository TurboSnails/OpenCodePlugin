# Changelog

## 1.3.0 - 2026-07-27

- Add a per-project server load manifest so `cli-dispatch doctor` can judge duplicate registration and `CLI_DISPATCH_DEV` state from the OpenCode server process, not just the doctor process.
- Add CI for build, default tests, `CLI_DISPATCH_DEV=1` tests, and isolated-HOME tests.
- Fix stale tarball version in installation docs.

## 1.2.1 - 2026-07-27

- Clarify doctor env-scope detail and restore config lookup note in installation docs.
- Add `bun run test:dev` for the `CLI_DISPATCH_DEV=1` test matrix.

## 1.2.0 - 2026-07-27

- Gate the repo-local plugin wrapper behind `CLI_DISPATCH_DEV=1`.
- Tell stale sessions to start a brand-new OpenCode session instead of resuming.
- Add doctor duplicate-registration detection and safe fix for the old dogfood wrapper.
